import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Vector3,
  Quaternion,
  Observable,
} from '@babylonjs/core';
import type {
  IPhysicsEnginePluginV2,
  PhysicsBody,
  PhysicsShape,
  PhysicsConstraint,
  PhysicsMassProperties,
  PhysicsMaterial,
  PhysicsShapeParameters,
  PhysicsRaycastResult,
  IRaycastQuery,
  IPhysicsCollisionEvent,
  IBasePhysicsCollisionEvent,
  ConstrainedBodyPair,
  BoundingBox,
} from '@babylonjs/core';
import type { IPhysicsShapeCastQuery } from '@babylonjs/core/Physics/physicsShapeCastQuery';
import type { IPhysicsShapeProximityCastQuery } from '@babylonjs/core/Physics/physicsShapeProximityCastQuery';
import type { IPhysicsPointProximityQuery } from '@babylonjs/core/Physics/physicsPointProximityQuery';
import { ShapeCastResult } from '@babylonjs/core/Physics/shapeCastResult';
import { ProximityCastResult } from '@babylonjs/core/Physics/proximityCastResult';
import {
  PhysicsShapeType,
} from '@babylonjs/core';
import type {
  PhysicsMotionType,
  PhysicsConstraintAxisLimitMode,
  PhysicsConstraintMotorType,
  PhysicsConstraintAxis,
} from '@babylonjs/core';
import type { Mesh, TransformNode, Nullable } from '@babylonjs/core';
import type { CollisionEventData } from '@rapierphysicsplugin/shared';
import type { AxisConfig, ShapeRawData } from './rapier-types.js';

import { processCollisionEvents, injectCollisionEvents } from './rapier-collision-ops.js';
import * as bodyOps from './rapier-body-ops.js';
import * as shapeOps from './rapier-shape-ops.js';
import * as constraintOps from './rapier-constraint-ops.js';

export class RapierPlugin implements IPhysicsEnginePluginV2 {
  public world: RAPIER.World;
  public name = 'RapierPlugin';
  public onCollisionObservable = new Observable<IPhysicsCollisionEvent>();
  public onCollisionEndedObservable = new Observable<IBasePhysicsCollisionEvent>();
  public onTriggerCollisionObservable = new Observable<IBasePhysicsCollisionEvent>();

  public rapier: typeof RAPIER;
  public bodyToRigidBody = new Map<PhysicsBody, RAPIER.RigidBody>();
  public bodyToColliders = new Map<PhysicsBody, RAPIER.Collider[]>();
  public shapeToColliderDesc = new Map<PhysicsShape, RAPIER.ColliderDesc>();
  public shapeTypeMap = new Map<PhysicsShape, PhysicsShapeType>();
  public shapeMaterialMap = new Map<PhysicsShape, PhysicsMaterial>();
  public shapeDensityMap = new Map<PhysicsShape, number>();
  public shapeFilterMembership = new Map<PhysicsShape, number>();
  public shapeFilterCollide = new Map<PhysicsShape, number>();
  public bodyCollisionObservables = new Map<PhysicsBody, Observable<IPhysicsCollisionEvent>>();
  public bodyCollisionEndedObservables = new Map<PhysicsBody, Observable<IBasePhysicsCollisionEvent>>();
  public constraintToJoint = new Map<PhysicsConstraint, RAPIER.ImpulseJoint>();
  public constraintBodies = new Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>();
  public constraintAxisState = new Map<PhysicsConstraint, Map<number, AxisConfig>>();
  public constraintEnabled = new Map<PhysicsConstraint, boolean>();
  public constraintDescriptors = new Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>();
  public collisionCallbackEnabled = new Set<PhysicsBody>();
  public collisionEndedCallbackEnabled = new Set<PhysicsBody>();
  public triggerShapes = new Set<PhysicsShape>();
  public bodyIdToPhysicsBody = new Map<string, PhysicsBody>();
  private maxLinearVelocity = 200;
  private maxAngularVelocity = 200;

  public bodyToShape = new Map<PhysicsBody, PhysicsShape>();
  public shapeToBody = new Map<PhysicsShape, PhysicsBody>();
  public compoundChildren = new Map<PhysicsShape, Array<{ child: PhysicsShape; translation?: Vector3; rotation?: Quaternion; scale?: Vector3 }>>();
  public bodyEventMask = new Map<PhysicsBody, number>();
  public eventQueue!: RAPIER.EventQueue;
  public colliderHandleToBody = new Map<number, PhysicsBody>();
  public activeCollisionPairs = new Set<string>();
  public shapeRawData = new Map<PhysicsShape, ShapeRawData>();

  constructor(rapier: typeof RAPIER, gravity?: Vector3) {
    this.rapier = rapier;
    const g = gravity ?? new Vector3(0, -9.81, 0);
    this.world = new rapier.World(new rapier.Vector3(g.x, g.y, g.z));
    this.eventQueue = new rapier.EventQueue(false);
  }

  // --- Core ---

  getPluginVersion(): number { return 2; }

  setGravity(gravity: Vector3): void {
    this.world.gravity = new this.rapier.Vector3(gravity.x, gravity.y, gravity.z);
  }

  setTimeStep(timeStep: number): void { this.world.timestep = timeStep; }
  getTimeStep(): number { return this.world.timestep; }

  setVelocityLimits(maxLinearVelocity: number, maxAngularVelocity: number): void {
    this.maxLinearVelocity = maxLinearVelocity;
    this.maxAngularVelocity = maxAngularVelocity;
  }

  getMaxLinearVelocity(): number { return this.maxLinearVelocity; }
  getMaxAngularVelocity(): number { return this.maxAngularVelocity; }

  executeStep(_delta: number, bodies: Array<PhysicsBody>): void {
    this.world.step(this.eventQueue);
    processCollisionEvents(this, this.eventQueue);
    for (const body of bodies) {
      this.sync(body);
    }
  }

  // --- Body lifecycle ---

  initBody(body: PhysicsBody, motionType: PhysicsMotionType, position: Vector3, orientation: Quaternion): void {
    bodyOps.initBody(this, body, motionType, position, orientation);
  }

  initBodyInstances(_body: PhysicsBody, _motionType: PhysicsMotionType, _mesh: Mesh): void {}
  updateBodyInstances(_body: PhysicsBody, _mesh: Mesh): void {}

  removeBody(body: PhysicsBody): void { this.disposeBody(body); }
  disposeBody(body: PhysicsBody): void { bodyOps.disposeBody(this, body); }

  sync(body: PhysicsBody): void { bodyOps.syncBody(this, body); }
  syncTransform(body: PhysicsBody, transformNode: TransformNode): void { bodyOps.syncTransform(this, body, transformNode); }

  // --- Shape management ---

  initShape(shape: PhysicsShape, type: PhysicsShapeType, options: PhysicsShapeParameters): void {
    shapeOps.initShape(this, shape, type, options);
  }

  setShape(body: PhysicsBody, shape: Nullable<PhysicsShape>): void { shapeOps.setShape(this, body, shape); }
  getShape(body: PhysicsBody): Nullable<PhysicsShape> { return this.bodyToShape.get(body) ?? null; }
  getShapeType(shape: PhysicsShape): PhysicsShapeType { return this.shapeTypeMap.get(shape) as PhysicsShapeType; }
  disposeShape(shape: PhysicsShape): void { shapeOps.disposeShape(this, shape); }

  // --- Shape filtering ---

  setShapeFilterMembershipMask(shape: PhysicsShape, membershipMask: number): void { shapeOps.setShapeFilterMembershipMask(this, shape, membershipMask); }
  getShapeFilterMembershipMask(shape: PhysicsShape): number { return shapeOps.getShapeFilterMembershipMask(this, shape); }
  setShapeFilterCollideMask(shape: PhysicsShape, collideMask: number): void { shapeOps.setShapeFilterCollideMask(this, shape, collideMask); }
  getShapeFilterCollideMask(shape: PhysicsShape): number { return shapeOps.getShapeFilterCollideMask(this, shape); }

  // --- Shape material ---

  setMaterial(shape: PhysicsShape, material: PhysicsMaterial): void { shapeOps.setMaterial(this, shape, material); }
  getMaterial(shape: PhysicsShape): PhysicsMaterial { return shapeOps.getMaterial(this, shape); }
  setDensity(shape: PhysicsShape, density: number): void { shapeOps.setDensity(this, shape, density); }
  getDensity(shape: PhysicsShape): number { return shapeOps.getDensity(this, shape); }

  // --- Compound shapes ---

  addChild(shape: PhysicsShape, newChild: PhysicsShape, translation?: Vector3, rotation?: Quaternion, scale?: Vector3): void {
    shapeOps.addChild(this, shape, newChild, translation, rotation, scale);
  }
  removeChild(shape: PhysicsShape, childIndex: number): void { shapeOps.removeChild(this, shape, childIndex); }
  getNumChildren(shape: PhysicsShape): number { return shapeOps.getNumChildren(this, shape); }

  // --- Bounding box ---

  getBoundingBox(shape: PhysicsShape): BoundingBox { return shapeOps.getBoundingBox(this, shape); }
  getBodyBoundingBox(body: PhysicsBody): BoundingBox { return shapeOps.getBodyBoundingBox(this, body); }

  // --- Triggers & collision callbacks ---

  setTrigger(shape: PhysicsShape, isTrigger: boolean): void { shapeOps.setTrigger(this, shape, isTrigger); }

  setCollisionCallbackEnabled(body: PhysicsBody, enabled: boolean, _instanceIndex?: number): void {
    if (enabled) { this.collisionCallbackEnabled.add(body); } else { this.collisionCallbackEnabled.delete(body); }
  }

  setCollisionEndedCallbackEnabled(body: PhysicsBody, enabled: boolean, _instanceIndex?: number): void {
    if (enabled) { this.collisionEndedCallbackEnabled.add(body); } else { this.collisionEndedCallbackEnabled.delete(body); }
  }

  // --- Event mask ---

  setEventMask(body: PhysicsBody, eventMask: number, _instanceIndex?: number): void { this.bodyEventMask.set(body, eventMask); }
  getEventMask(body: PhysicsBody, _instanceIndex?: number): number { return this.bodyEventMask.get(body) ?? 0; }

  // --- Motion type ---

  setMotionType(body: PhysicsBody, motionType: PhysicsMotionType, _instanceIndex?: number): void { bodyOps.setMotionType(this, body, motionType); }
  getMotionType(body: PhysicsBody, _instanceIndex?: number): PhysicsMotionType { return bodyOps.getMotionType(this, body); }

  // --- Mass properties ---

  computeMassProperties(body: PhysicsBody, _instanceIndex?: number): PhysicsMassProperties { return bodyOps.computeMassProperties(this, body); }
  setMassProperties(body: PhysicsBody, massProps: PhysicsMassProperties, _instanceIndex?: number): void { bodyOps.setMassProperties(this, body, massProps); }
  getMassProperties(body: PhysicsBody, _instanceIndex?: number): PhysicsMassProperties { return bodyOps.getMassProperties(this, body); }

  // --- Damping ---

  setLinearDamping(body: PhysicsBody, damping: number, _instanceIndex?: number): void { bodyOps.setLinearDamping(this, body, damping); }
  getLinearDamping(body: PhysicsBody, _instanceIndex?: number): number { return bodyOps.getLinearDamping(this, body); }
  setAngularDamping(body: PhysicsBody, damping: number, _instanceIndex?: number): void { bodyOps.setAngularDamping(this, body, damping); }
  getAngularDamping(body: PhysicsBody, _instanceIndex?: number): number { return bodyOps.getAngularDamping(this, body); }

  // --- Velocity ---

  setLinearVelocity(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void { bodyOps.setLinearVelocity(this, body, linVel); }
  getLinearVelocityToRef(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void { bodyOps.getLinearVelocityToRef(this, body, linVel); }
  setAngularVelocity(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void { bodyOps.setAngularVelocity(this, body, angVel); }
  getAngularVelocityToRef(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void { bodyOps.getAngularVelocityToRef(this, body, angVel); }

  // --- Forces & impulses ---

  applyImpulse(body: PhysicsBody, impulse: Vector3, location: Vector3, _instanceIndex?: number): void { bodyOps.applyImpulse(this, body, impulse, location); }
  applyAngularImpulse(body: PhysicsBody, angularImpulse: Vector3, _instanceIndex?: number): void { bodyOps.applyAngularImpulse(this, body, angularImpulse); }
  applyForce(body: PhysicsBody, force: Vector3, location: Vector3, _instanceIndex?: number): void { bodyOps.applyForce(this, body, force, location); }
  applyTorque(body: PhysicsBody, torque: Vector3, _instanceIndex?: number): void { bodyOps.applyTorque(this, body, torque); }

  // --- Gravity factor ---

  setGravityFactor(body: PhysicsBody, factor: number, _instanceIndex?: number): void { bodyOps.setGravityFactor(this, body, factor); }
  getGravityFactor(body: PhysicsBody, _instanceIndex?: number): number { return bodyOps.getGravityFactor(this, body); }

  // --- Target transform (kinematic) ---

  setTargetTransform(body: PhysicsBody, position: Vector3, rotation: Quaternion, _instanceIndex?: number): void {
    bodyOps.setTargetTransform(this, body, position, rotation);
  }

  // --- Body geometry ---

  getBodyGeometry(body: PhysicsBody): { positions: Float32Array; indices: Uint32Array } | {} {
    const shape = this.bodyToShape.get(body);
    if (!shape) return {};

    const shapeType = this.shapeTypeMap.get(shape);
    if (shapeType === undefined) return {};

    const colliders = this.bodyToColliders.get(body);
    if (!colliders || colliders.length === 0) return {};

    switch (shapeType) {
      case PhysicsShapeType.BOX:
        return this._boxGeo(colliders[0]);
      case PhysicsShapeType.SPHERE:
        return this._sphereGeo(colliders[0]);
      case PhysicsShapeType.CAPSULE:
        return this._capsuleGeo(colliders[0]);
      case PhysicsShapeType.CYLINDER:
        return this._cylinderGeo(colliders[0]);
      case PhysicsShapeType.MESH: {
        const raw = this.shapeRawData.get(shape);
        if (raw?.vertices && raw?.indices) return { positions: raw.vertices, indices: raw.indices };
        return {};
      }
      case PhysicsShapeType.CONVEX_HULL:
        return this._convexHullGeo(colliders[0], shape);
      case PhysicsShapeType.HEIGHTFIELD:
        return this._heightfieldGeo(shape);
      case PhysicsShapeType.CONTAINER:
        return this._containerGeo(body, shape);
      default:
        return {};
    }
  }

  private _boxGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
    const he = collider.halfExtents();
    const hx = he.x, hy = he.y, hz = he.z;
    const positions = new Float32Array([
      -hx, -hy, -hz,   hx, -hy, -hz,   hx,  hy, -hz,  -hx,  hy, -hz,
      -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
    ]);
    const indices = new Uint32Array([
      4, 5, 6,  4, 6, 7,   // +z
      1, 0, 3,  1, 3, 2,   // -z
      5, 1, 2,  5, 2, 6,   // +x
      0, 4, 7,  0, 7, 3,   // -x
      3, 7, 6,  3, 6, 2,   // +y
      0, 1, 5,  0, 5, 4,   // -y
    ]);
    return { positions, indices };
  }

  private _sphereGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
    const r = collider.radius();
    const seg = 16, rings = 12;
    const positions = new Float32Array((rings + 1) * (seg + 1) * 3);
    let vi = 0;
    for (let ri = 0; ri <= rings; ri++) {
      const phi = (ri / rings) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let si = 0; si <= seg; si++) {
        const theta = (si / seg) * Math.PI * 2;
        positions[vi++] = r * sp * Math.cos(theta);
        positions[vi++] = r * cp;
        positions[vi++] = r * sp * Math.sin(theta);
      }
    }
    const indices = new Uint32Array(rings * seg * 6);
    let ii = 0;
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < seg; si++) {
        const a = ri * (seg + 1) + si;
        const b = a + seg + 1;
        indices[ii++] = a; indices[ii++] = b;     indices[ii++] = a + 1;
        indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
      }
    }
    return { positions, indices };
  }

  private _capsuleGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
    const r = collider.radius();
    const hh = collider.halfHeight();
    const seg = 16, hemiRings = 8;
    const totalRings = hemiRings * 2;
    const positions = new Float32Array((totalRings + 1) * (seg + 1) * 3);
    let vi = 0;
    for (let ri = 0; ri <= totalRings; ri++) {
      const phi = (ri / totalRings) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      const yOff = ri <= hemiRings ? hh : -hh;
      for (let si = 0; si <= seg; si++) {
        const theta = (si / seg) * Math.PI * 2;
        positions[vi++] = r * sp * Math.cos(theta);
        positions[vi++] = r * cp + yOff;
        positions[vi++] = r * sp * Math.sin(theta);
      }
    }
    const indices = new Uint32Array(totalRings * seg * 6);
    let ii = 0;
    for (let ri = 0; ri < totalRings; ri++) {
      for (let si = 0; si < seg; si++) {
        const a = ri * (seg + 1) + si;
        const b = a + seg + 1;
        indices[ii++] = a; indices[ii++] = b;     indices[ii++] = a + 1;
        indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
      }
    }
    return { positions, indices };
  }

  private _cylinderGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
    const r = collider.radius();
    const hh = collider.halfHeight();
    const seg = 16;
    // Vertices: topCenter + topRing(seg+1) + bottomRing(seg+1) + bottomCenter
    const positions = new Float32Array((2 + 2 * (seg + 1)) * 3);
    let vi = 0;
    // top center (0)
    positions[vi++] = 0; positions[vi++] = hh; positions[vi++] = 0;
    // top ring (1..seg+1)
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      positions[vi++] = r * Math.cos(t); positions[vi++] = hh; positions[vi++] = r * Math.sin(t);
    }
    // bottom ring (seg+2..2*seg+2)
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      positions[vi++] = r * Math.cos(t); positions[vi++] = -hh; positions[vi++] = r * Math.sin(t);
    }
    // bottom center
    positions[vi++] = 0; positions[vi++] = -hh; positions[vi++] = 0;

    const topR = 1, botR = seg + 2, botC = 2 * (seg + 1) + 1;
    const indices = new Uint32Array(seg * 4 * 3);
    let ii = 0;
    for (let s = 0; s < seg; s++) {
      // top cap
      indices[ii++] = 0;        indices[ii++] = topR + s + 1; indices[ii++] = topR + s;
      // bottom cap
      indices[ii++] = botC;     indices[ii++] = botR + s;     indices[ii++] = botR + s + 1;
      // side
      indices[ii++] = topR + s; indices[ii++] = topR + s + 1; indices[ii++] = botR + s;
      indices[ii++] = topR + s + 1; indices[ii++] = botR + s + 1; indices[ii++] = botR + s;
    }
    return { positions, indices };
  }

  private _convexHullGeo(collider: RAPIER.Collider, shape: PhysicsShape): { positions: Float32Array; indices: Uint32Array } | {} {
    // Try Rapier's built-in vertex/index extraction
    const verts = (collider as any).vertices?.() as Float32Array | undefined;
    const idx = (collider as any).indices?.() as Uint32Array | undefined;
    if (verts && idx && verts.length > 0 && idx.length > 0) {
      return { positions: new Float32Array(verts), indices: new Uint32Array(idx) };
    }
    // Fallback: use raw vertices (no triangulation available)
    const raw = this.shapeRawData.get(shape);
    if (raw?.vertices) return { positions: raw.vertices, indices: new Uint32Array(0) };
    return {};
  }

  private _heightfieldGeo(shape: PhysicsShape): { positions: Float32Array; indices: Uint32Array } | {} {
    const raw = this.shapeRawData.get(shape);
    if (!raw?.heights || raw.nrows === undefined || raw.ncols === undefined) return {};
    const nrows = raw.nrows, ncols = raw.ncols;
    const sizeX = raw.sizeX ?? 1, sizeZ = raw.sizeZ ?? 1;
    // nrows = Z cells, ncols = X cells
    const numX = ncols + 1, numZ = nrows + 1;

    const positions = new Float32Array(numX * numZ * 3);
    let vi = 0;
    for (let z = 0; z < numZ; z++) {
      for (let x = 0; x < numX; x++) {
        positions[vi++] = (x / ncols - 0.5) * sizeX;
        positions[vi++] = raw.heights[x * numZ + z]; // column-major access
        positions[vi++] = (z / nrows - 0.5) * sizeZ;
      }
    }

    const indices = new Uint32Array(nrows * ncols * 6);
    let ii = 0;
    for (let z = 0; z < nrows; z++) {
      for (let x = 0; x < ncols; x++) {
        const a = z * numX + x;
        indices[ii++] = a;     indices[ii++] = a + numX; indices[ii++] = a + 1;
        indices[ii++] = a + 1; indices[ii++] = a + numX; indices[ii++] = a + numX + 1;
      }
    }
    return { positions, indices };
  }

  private _containerGeo(body: PhysicsBody, shape: PhysicsShape): { positions: Float32Array; indices: Uint32Array } | {} {
    const children = this.compoundChildren.get(shape);
    const colliders = this.bodyToColliders.get(body);
    if (!children || !colliders || children.length === 0) return {};

    const parts: Array<{ positions: Float32Array; indices: Uint32Array }> = [];
    for (let i = 0; i < children.length && i < colliders.length; i++) {
      const geo = this._colliderGeo(colliders[i], children[i].child);
      if (!geo) continue;

      const t = children[i].translation;
      const r = children[i].rotation;
      if (t || r) {
        const p = geo.positions;
        for (let v = 0; v < p.length; v += 3) {
          let x = p[v], y = p[v + 1], z = p[v + 2];
          if (r) {
            const qx = r.x, qy = r.y, qz = r.z, qw = r.w;
            const ix = qw * x + qy * z - qz * y;
            const iy = qw * y + qz * x - qx * z;
            const iz = qw * z + qx * y - qy * x;
            const iw = -qx * x - qy * y - qz * z;
            x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
            y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
            z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
          }
          if (t) { x += t.x; y += t.y; z += t.z; }
          p[v] = x; p[v + 1] = y; p[v + 2] = z;
        }
      }
      parts.push(geo);
    }

    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];

    let totalV = 0, totalI = 0;
    for (const g of parts) { totalV += g.positions.length; totalI += g.indices.length; }
    const positions = new Float32Array(totalV);
    const indices = new Uint32Array(totalI);
    let vOff = 0, iOff = 0, baseV = 0;
    for (const g of parts) {
      positions.set(g.positions, vOff);
      for (let j = 0; j < g.indices.length; j++) indices[iOff + j] = g.indices[j] + baseV;
      vOff += g.positions.length;
      iOff += g.indices.length;
      baseV += g.positions.length / 3;
    }
    return { positions, indices };
  }

  private _colliderGeo(collider: RAPIER.Collider, childShape: PhysicsShape): { positions: Float32Array; indices: Uint32Array } | null {
    const st = collider.shapeType();
    const R = this.rapier;
    if (st === R.ShapeType.Cuboid) return this._boxGeo(collider);
    if (st === R.ShapeType.Ball) return this._sphereGeo(collider);
    if (st === R.ShapeType.Capsule) return this._capsuleGeo(collider);
    if (st === R.ShapeType.Cylinder) return this._cylinderGeo(collider);
    if (st === R.ShapeType.ConvexPolyhedron) {
      const g = this._convexHullGeo(collider, childShape);
      return 'positions' in g ? g as { positions: Float32Array; indices: Uint32Array } : null;
    }
    if (st === R.ShapeType.TriMesh) {
      const raw = this.shapeRawData.get(childShape);
      if (raw?.vertices && raw?.indices) return { positions: raw.vertices, indices: raw.indices };
    }
    if (st === R.ShapeType.HeightField) {
      const g = this._heightfieldGeo(childShape);
      return 'positions' in g ? g as { positions: Float32Array; indices: Uint32Array } : null;
    }
    return null;
  }

  // --- Constraints ---

  initConstraint(constraint: PhysicsConstraint, body: PhysicsBody, childBody: PhysicsBody): void {
    constraintOps.initConstraint(this, constraint, body, childBody);
  }

  addConstraint(body: PhysicsBody, childBody: PhysicsBody, constraint: PhysicsConstraint, _instanceIndex?: number, _childInstanceIndex?: number): void {
    if (!this.constraintToJoint.has(constraint)) {
      this.initConstraint(constraint, body, childBody);
    }
  }

  disposeConstraint(constraint: PhysicsConstraint): void { constraintOps.disposeConstraint(this, constraint); }
  setEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void { constraintOps.setEnabled(this, constraint, isEnabled); }
  getEnabled(constraint: PhysicsConstraint): boolean { return constraintOps.getEnabled(this, constraint); }
  setCollisionsEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void { constraintOps.setCollisionsEnabled(this, constraint, isEnabled); }
  getCollisionsEnabled(constraint: PhysicsConstraint): boolean { return constraintOps.getCollisionsEnabled(this, constraint); }

  setAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, friction: number): void { constraintOps.setAxisFriction(this, constraint, axis, friction); }
  getAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> { return constraintOps.getAxisFriction(this, constraint, axis); }
  setAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limitMode: PhysicsConstraintAxisLimitMode): void { constraintOps.setAxisMode(this, constraint, axis, limitMode); }
  getAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintAxisLimitMode> { return constraintOps.getAxisMode(this, constraint, axis); }
  setAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, minLimit: number): void { constraintOps.setAxisMinLimit(this, constraint, axis, minLimit); }
  getAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> { return constraintOps.getAxisMinLimit(this, constraint, axis); }
  setAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limit: number): void { constraintOps.setAxisMaxLimit(this, constraint, axis, limit); }
  getAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> { return constraintOps.getAxisMaxLimit(this, constraint, axis); }
  setAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, motorType: PhysicsConstraintMotorType): void { constraintOps.setAxisMotorType(this, constraint, axis, motorType); }
  getAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintMotorType> { return constraintOps.getAxisMotorType(this, constraint, axis); }
  setAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, target: number): void { constraintOps.setAxisMotorTarget(this, constraint, axis, target); }
  getAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> { return constraintOps.getAxisMotorTarget(this, constraint, axis); }
  setAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, maxForce: number): void { constraintOps.setAxisMotorMaxForce(this, constraint, axis, maxForce); }
  getAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> { return constraintOps.getAxisMotorMaxForce(this, constraint, axis); }

  getBodiesUsingConstraint(constraint: PhysicsConstraint): ConstrainedBodyPair[] { return constraintOps.getBodiesUsingConstraint(this, constraint); }

  // --- Collision observables ---

  getCollisionObservable(body: PhysicsBody, _instanceIndex?: number): Observable<IPhysicsCollisionEvent> {
    let obs = this.bodyCollisionObservables.get(body);
    if (!obs) {
      obs = new Observable<IPhysicsCollisionEvent>();
      this.bodyCollisionObservables.set(body, obs);
    }
    return obs;
  }

  getCollisionEndedObservable(body: PhysicsBody, _instanceIndex?: number): Observable<IBasePhysicsCollisionEvent> {
    let obs = this.bodyCollisionEndedObservables.get(body);
    if (!obs) {
      obs = new Observable<IBasePhysicsCollisionEvent>();
      this.bodyCollisionEndedObservables.set(body, obs);
    }
    return obs;
  }

  // --- Raycast ---

  raycast(from: Vector3, to: Vector3, result: PhysicsRaycastResult, query?: IRaycastQuery): void {
    const dir = to.subtract(from);
    const maxToi = dir.length();
    const normalizedDir = dir.normalize();

    const ray = new this.rapier.Ray(
      new this.rapier.Vector3(from.x, from.y, from.z),
      new this.rapier.Vector3(normalizedDir.x, normalizedDir.y, normalizedDir.z)
    );

    let filterFlags: number | undefined;
    let filterGroups: number | undefined;

    if (query) {
      if (query.shouldHitTriggers === false) {
        filterFlags = this.rapier.QueryFilterFlags.EXCLUDE_SENSORS;
      }
      if (query.membership !== undefined || query.collideWith !== undefined) {
        const membership = query.membership ?? 0xFFFF;
        const collideWith = query.collideWith ?? 0xFFFF;
        filterGroups = (membership << 16) | collideWith;
      }
    }

    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups);
    if (hit) {
      const hitPoint = ray.pointAt(hit.timeOfImpact);
      const hitNormal = hit.normal;
      result.setHitData(
        new Vector3(hitNormal.x, hitNormal.y, hitNormal.z),
        new Vector3(hitPoint.x, hitPoint.y, hitPoint.z)
      );
      result.calculateHitDistance();
    }
  }

  // --- Shape casting & proximity ---

  private createRapierShape(shape: PhysicsShape): RAPIER.Shape | null {
    const type = this.shapeTypeMap.get(shape);
    const desc = this.shapeToColliderDesc.get(shape);
    if (type === undefined || !desc) return null;

    switch (type) {
      case PhysicsShapeType.BOX: {
        const he = (desc as any).halfExtents;
        if (he) return new this.rapier.Cuboid(he.x, he.y, he.z);
        return null;
      }
      case PhysicsShapeType.SPHERE: {
        const r = (desc as any).radius;
        if (r !== undefined) return new this.rapier.Ball(r);
        return null;
      }
      case PhysicsShapeType.CAPSULE: {
        const r = (desc as any).radius;
        const hh = (desc as any).halfHeight;
        if (r !== undefined && hh !== undefined) return new this.rapier.Capsule(hh, r);
        return null;
      }
      case PhysicsShapeType.CYLINDER: {
        const r = (desc as any).radius;
        const hh = (desc as any).halfHeight;
        if (r !== undefined && hh !== undefined) return new this.rapier.Cylinder(hh, r);
        return null;
      }
      case PhysicsShapeType.CONVEX_HULL: {
        const raw = this.shapeRawData.get(shape);
        if (raw?.vertices) {
          return new this.rapier.ConvexPolyhedron(raw.vertices, null);
        }
        return null;
      }
      case PhysicsShapeType.MESH:
        // Rapier does not support trimeshes as query shapes
        return null;
      case PhysicsShapeType.HEIGHTFIELD:
        // Rapier does not support heightfields as query shapes
        return null;
      default:
        return null;
    }
  }

  private findBodyForColliderHandle(handle: number): { body: PhysicsBody; shape: PhysicsShape } | null {
    const body = this.colliderHandleToBody.get(handle);
    if (!body) return null;
    const shape = this.bodyToShape.get(body);
    if (!shape) return null;
    return { body, shape };
  }

  shapeCast(query: IPhysicsShapeCastQuery, inputShapeResult: ShapeCastResult, hitShapeResult: ShapeCastResult): void {
    const rapierShape = this.createRapierShape(query.shape);
    if (!rapierShape) return;

    const dir = query.endPosition.subtract(query.startPosition);
    const maxToi = dir.length();
    if (maxToi === 0) return;
    const vel = dir.normalize();

    const shapePos = new this.rapier.Vector3(query.startPosition.x, query.startPosition.y, query.startPosition.z);
    const shapeRot = new this.rapier.Quaternion(query.rotation.x, query.rotation.y, query.rotation.z, query.rotation.w);
    const shapeVel = new this.rapier.Vector3(vel.x, vel.y, vel.z);

    const excludeRb = query.ignoreBody ? this.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

    const hit = this.world.castShape(shapePos, shapeRot, shapeVel, rapierShape, 0, maxToi, true, undefined, undefined, undefined, excludeRb ?? undefined);
    if (hit) {
      const fraction = hit.time_of_impact / maxToi;
      const hitNormal = hit.normal1;
      const hitPoint = hit.witness1;

      inputShapeResult.setHitData(
        new Vector3(hitNormal.x, hitNormal.y, hitNormal.z),
        new Vector3(
          query.startPosition.x + vel.x * hit.time_of_impact,
          query.startPosition.y + vel.y * hit.time_of_impact,
          query.startPosition.z + vel.z * hit.time_of_impact,
        ),
      );
      inputShapeResult.setHitFraction(fraction);

      hitShapeResult.setHitData(
        new Vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z),
        new Vector3(hitPoint.x, hitPoint.y, hitPoint.z),
      );
      hitShapeResult.setHitFraction(fraction);

      const info = this.findBodyForColliderHandle(hit.collider.handle);
      if (info) {
        hitShapeResult.body = info.body;
        hitShapeResult.shape = info.shape;
      }
    }
  }

  shapeProximity(query: IPhysicsShapeProximityCastQuery, inputShapeResult: ProximityCastResult, hitShapeResult: ProximityCastResult): void {
    const rapierShape = this.createRapierShape(query.shape);
    if (!rapierShape) return;

    const shapePos = new this.rapier.Vector3(query.position.x, query.position.y, query.position.z);
    const shapeRot = new this.rapier.Quaternion(query.rotation.x, query.rotation.y, query.rotation.z, query.rotation.w);
    const zeroVel = new this.rapier.Vector3(0, 0, 0);

    const excludeRb = query.ignoreBody ? this.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

    const hit = this.world.castShape(shapePos, shapeRot, zeroVel, rapierShape, query.maxDistance, 0, true, undefined, undefined, undefined, excludeRb ?? undefined);
    if (hit) {
      inputShapeResult.setHitData(
        new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
        new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
      );
      inputShapeResult.setHitDistance(hit.time_of_impact);

      hitShapeResult.setHitData(
        new Vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z),
        new Vector3(hit.witness2.x, hit.witness2.y, hit.witness2.z),
      );
      hitShapeResult.setHitDistance(hit.time_of_impact);

      const info = this.findBodyForColliderHandle(hit.collider.handle);
      if (info) {
        hitShapeResult.body = info.body;
        hitShapeResult.shape = info.shape;
      }
    }
  }

  pointProximity(query: IPhysicsPointProximityQuery, result: ProximityCastResult): void {
    const point = new this.rapier.Vector3(query.position.x, query.position.y, query.position.z);

    const excludeRb = query.ignoreBody ? this.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

    const projection = this.world.projectPoint(point, true, undefined, undefined, undefined, excludeRb ?? undefined);
    if (projection) {
      const dist = Math.sqrt(
        (projection.point.x - query.position.x) ** 2 +
        (projection.point.y - query.position.y) ** 2 +
        (projection.point.z - query.position.z) ** 2,
      );

      if (dist <= query.maxDistance) {
        const normal = dist > 0
          ? new Vector3(
              (query.position.x - projection.point.x) / dist,
              (query.position.y - projection.point.y) / dist,
              (query.position.z - projection.point.z) / dist,
            )
          : new Vector3(0, 1, 0);

        result.setHitData(
          normal,
          new Vector3(projection.point.x, projection.point.y, projection.point.z),
        );
        result.setHitDistance(dist);

        const info = this.findBodyForColliderHandle(projection.collider.handle);
        if (info) {
          result.body = info.body;
          result.shape = info.shape;
        }
      }
    }
  }

  // --- Dispose ---

  dispose(): void {
    this.eventQueue.free();
    this.world.free();
    this.bodyToRigidBody.clear();
    this.bodyToColliders.clear();
    this.shapeToColliderDesc.clear();
    this.shapeTypeMap.clear();
    this.constraintToJoint.clear();
    this.constraintBodies.clear();
    this.constraintAxisState.clear();
    this.constraintEnabled.clear();
    this.constraintDescriptors.clear();
    this.collisionCallbackEnabled.clear();
    this.collisionEndedCallbackEnabled.clear();
    this.triggerShapes.clear();
    this.bodyIdToPhysicsBody.clear();
    this.bodyToShape.clear();
    this.shapeToBody.clear();
    this.compoundChildren.clear();
    this.bodyEventMask.clear();
    this.colliderHandleToBody.clear();
    this.activeCollisionPairs.clear();
    this.shapeFilterMembership.clear();
    this.shapeFilterCollide.clear();
    this.shapeRawData.clear();
  }

  // --- Rapier-specific helpers for sync module ---

  getRigidBody(body: PhysicsBody): RAPIER.RigidBody | undefined {
    return this.bodyToRigidBody.get(body);
  }

  setBodyTranslation(body: PhysicsBody, position: Vector3): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) {
      rb.setTranslation(new this.rapier.Vector3(position.x, position.y, position.z), true);
    }
  }

  setBodyRotation(body: PhysicsBody, rotation: Quaternion): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) {
      rb.setRotation(new this.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), true);
    }
  }

  // --- Server collision event injection ---

  registerBodyId(bodyId: string, body: PhysicsBody): void {
    this.bodyIdToPhysicsBody.set(bodyId, body);
  }

  unregisterBodyId(bodyId: string): void {
    this.bodyIdToPhysicsBody.delete(bodyId);
  }

  injectCollisionEvents(events: CollisionEventData[]): void {
    injectCollisionEvents(this, events);
  }
}
