import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Vector3,
  Quaternion,
  Observable,
  BoundingBox,
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
} from '@babylonjs/core';
import {
  PhysicsMotionType,
  PhysicsShapeType,
  PhysicsConstraintAxisLimitMode,
  PhysicsConstraintMotorType,
  PhysicsConstraintAxis,
  PhysicsConstraintType,
  PhysicsEventType,
} from '@babylonjs/core';
import type { Mesh, TransformNode, Nullable } from '@babylonjs/core';
import type { CollisionEventData, ConstraintDescriptor, Vec3 } from '@rapierphysicsplugin/shared';
import { createJointData, axisToFrame } from '@rapierphysicsplugin/shared';

interface AxisConfig {
  mode?: PhysicsConstraintAxisLimitMode;
  minLimit?: number;
  maxLimit?: number;
  friction?: number;
  motorType?: PhysicsConstraintMotorType;
  motorTarget?: number;
  motorMaxForce?: number;
}

function v3toVec(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export class RapierPlugin implements IPhysicsEnginePluginV2 {
  public world: RAPIER.World;
  public name = 'RapierPlugin';
  public onCollisionObservable = new Observable<IPhysicsCollisionEvent>();
  public onCollisionEndedObservable = new Observable<IBasePhysicsCollisionEvent>();
  public onTriggerCollisionObservable = new Observable<IBasePhysicsCollisionEvent>();

  private rapier: typeof RAPIER;
  private bodyToRigidBody = new Map<PhysicsBody, RAPIER.RigidBody>();
  private bodyToColliders = new Map<PhysicsBody, RAPIER.Collider[]>();
  private shapeToColliderDesc = new Map<PhysicsShape, RAPIER.ColliderDesc>();
  private shapeTypeMap = new Map<PhysicsShape, PhysicsShapeType>();
  private shapeMaterialMap = new Map<PhysicsShape, PhysicsMaterial>();
  private shapeDensityMap = new Map<PhysicsShape, number>();
  private shapeFilterMembership = new Map<PhysicsShape, number>();
  private shapeFilterCollide = new Map<PhysicsShape, number>();
  private bodyCollisionObservables = new Map<PhysicsBody, Observable<IPhysicsCollisionEvent>>();
  private bodyCollisionEndedObservables = new Map<PhysicsBody, Observable<IBasePhysicsCollisionEvent>>();
  private constraintToJoint = new Map<PhysicsConstraint, RAPIER.ImpulseJoint>();
  private constraintBodies = new Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>();
  private constraintAxisState = new Map<PhysicsConstraint, Map<number, AxisConfig>>();
  private constraintEnabled = new Map<PhysicsConstraint, boolean>();
  private constraintDescriptors = new Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>();
  private collisionCallbackEnabled = new Set<PhysicsBody>();
  private collisionEndedCallbackEnabled = new Set<PhysicsBody>();
  private triggerShapes = new Set<PhysicsShape>();
  private bodyIdToPhysicsBody = new Map<string, PhysicsBody>();
  private maxLinearVelocity = 200;
  private maxAngularVelocity = 200;

  constructor(rapier: typeof RAPIER, gravity?: Vector3) {
    this.rapier = rapier;
    const g = gravity ?? new Vector3(0, -9.81, 0);
    this.world = new rapier.World(new rapier.Vector3(g.x, g.y, g.z));
  }

  // --- Core ---

  getPluginVersion(): number {
    return 2;
  }

  setGravity(gravity: Vector3): void {
    this.world.gravity = new this.rapier.Vector3(gravity.x, gravity.y, gravity.z);
  }

  setTimeStep(timeStep: number): void {
    this.world.timestep = timeStep;
  }

  getTimeStep(): number {
    return this.world.timestep;
  }

  setVelocityLimits(maxLinearVelocity: number, maxAngularVelocity: number): void {
    this.maxLinearVelocity = maxLinearVelocity;
    this.maxAngularVelocity = maxAngularVelocity;
  }

  getMaxLinearVelocity(): number {
    return this.maxLinearVelocity;
  }

  getMaxAngularVelocity(): number {
    return this.maxAngularVelocity;
  }

  executeStep(delta: number, bodies: Array<PhysicsBody>): void {
    this.world.step();

    // Sync transforms back to BabylonJS bodies
    for (const body of bodies) {
      this.sync(body);
    }
  }

  // --- Body lifecycle ---

  initBody(body: PhysicsBody, motionType: PhysicsMotionType, position: Vector3, orientation: Quaternion): void {
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (motionType) {
      case PhysicsMotionType.DYNAMIC:
        bodyDesc = this.rapier.RigidBodyDesc.dynamic();
        break;
      case PhysicsMotionType.STATIC:
        bodyDesc = this.rapier.RigidBodyDesc.fixed();
        break;
      case PhysicsMotionType.ANIMATED:
        bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased();
        break;
      default:
        bodyDesc = this.rapier.RigidBodyDesc.dynamic();
    }

    bodyDesc.setTranslation(position.x, position.y, position.z);
    bodyDesc.setRotation(new this.rapier.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

    const rigidBody = this.world.createRigidBody(bodyDesc);
    this.bodyToRigidBody.set(body, rigidBody);
    this.bodyToColliders.set(body, []);
  }

  initBodyInstances(_body: PhysicsBody, _motionType: PhysicsMotionType, _mesh: Mesh): void {
    // Instanced bodies not supported in Rapier plugin
  }

  updateBodyInstances(_body: PhysicsBody, _mesh: Mesh): void {
    // Instanced bodies not supported
  }

  removeBody(body: PhysicsBody): void {
    this.disposeBody(body);
  }

  disposeBody(body: PhysicsBody): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) {
      this.world.removeRigidBody(rb);
      this.bodyToRigidBody.delete(body);
      this.bodyToColliders.delete(body);
      this.bodyCollisionObservables.delete(body);
      this.bodyCollisionEndedObservables.delete(body);
      this.collisionCallbackEnabled.delete(body);
      this.collisionEndedCallbackEnabled.delete(body);
    }
  }

  sync(body: PhysicsBody): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;
    const tn = body.transformNode;
    if (!tn) return;

    const pos = rb.translation();
    const rot = rb.rotation();
    tn.position.set(pos.x, pos.y, pos.z);
    tn.rotationQuaternion = tn.rotationQuaternion ?? new Quaternion();
    tn.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  syncTransform(body: PhysicsBody, transformNode: TransformNode): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    const pos = rb.translation();
    const rot = rb.rotation();
    transformNode.position.set(pos.x, pos.y, pos.z);
    transformNode.rotationQuaternion = transformNode.rotationQuaternion ?? new Quaternion();
    transformNode.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  // --- Shape management ---

  initShape(shape: PhysicsShape, type: PhysicsShapeType, options: PhysicsShapeParameters): void {
    let colliderDesc: RAPIER.ColliderDesc;

    switch (type) {
      case PhysicsShapeType.BOX: {
        const ext = options.extents ?? new Vector3(1, 1, 1);
        colliderDesc = this.rapier.ColliderDesc.cuboid(ext.x / 2, ext.y / 2, ext.z / 2);
        break;
      }
      case PhysicsShapeType.SPHERE: {
        const r = options.radius ?? 0.5;
        colliderDesc = this.rapier.ColliderDesc.ball(r);
        break;
      }
      case PhysicsShapeType.CAPSULE: {
        const pointA = options.pointA ?? new Vector3(0, 0, 0);
        const pointB = options.pointB ?? new Vector3(0, 1, 0);
        const halfHeight = Vector3.Distance(pointA, pointB) / 2;
        const radius = options.radius ?? 0.5;
        colliderDesc = this.rapier.ColliderDesc.capsule(halfHeight, radius);
        break;
      }
      case PhysicsShapeType.CYLINDER: {
        const pointA = options.pointA ?? new Vector3(0, 0, 0);
        const pointB = options.pointB ?? new Vector3(0, 1, 0);
        const halfHeight = Vector3.Distance(pointA, pointB) / 2;
        const radius = options.radius ?? 0.5;
        colliderDesc = this.rapier.ColliderDesc.cylinder(halfHeight, radius);
        break;
      }
      case PhysicsShapeType.MESH: {
        const mesh = options.mesh;
        if (mesh) {
          const positions = mesh.getVerticesData('position');
          const indices = mesh.getIndices();
          if (positions && indices) {
            colliderDesc = this.rapier.ColliderDesc.trimesh(
              new Float32Array(positions),
              new Uint32Array(indices)
            );
          } else {
            colliderDesc = this.rapier.ColliderDesc.ball(0.5);
          }
        } else {
          colliderDesc = this.rapier.ColliderDesc.ball(0.5);
        }
        break;
      }
      case PhysicsShapeType.CONVEX_HULL: {
        const mesh = options.mesh;
        if (mesh) {
          const positions = mesh.getVerticesData('position');
          if (positions) {
            const desc = this.rapier.ColliderDesc.convexHull(new Float32Array(positions));
            colliderDesc = desc ?? this.rapier.ColliderDesc.ball(0.5);
          } else {
            colliderDesc = this.rapier.ColliderDesc.ball(0.5);
          }
        } else {
          colliderDesc = this.rapier.ColliderDesc.ball(0.5);
        }
        break;
      }
      case PhysicsShapeType.CONTAINER: {
        // Container shapes are compound — start with a dummy
        colliderDesc = this.rapier.ColliderDesc.ball(0.001);
        break;
      }
      case PhysicsShapeType.HEIGHTFIELD: {
        colliderDesc = this.rapier.ColliderDesc.ball(0.5);
        break;
      }
      default:
        colliderDesc = this.rapier.ColliderDesc.ball(0.5);
    }

    this.shapeToColliderDesc.set(shape, colliderDesc);
    this.shapeTypeMap.set(shape, type);
  }

  setShape(body: PhysicsBody, shape: Nullable<PhysicsShape>): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    // Remove existing colliders
    const existing = this.bodyToColliders.get(body) ?? [];
    for (const col of existing) {
      this.world.removeCollider(col, false);
    }

    if (!shape) {
      this.bodyToColliders.set(body, []);
      return;
    }

    const desc = this.shapeToColliderDesc.get(shape);
    if (!desc) return;

    const collider = this.world.createCollider(desc, rb);
    this.bodyToColliders.set(body, [collider]);
  }

  getShape(_body: PhysicsBody): Nullable<PhysicsShape> {
    return null;
  }

  getShapeType(shape: PhysicsShape): PhysicsShapeType {
    return this.shapeTypeMap.get(shape) ?? PhysicsShapeType.BOX;
  }

  disposeShape(shape: PhysicsShape): void {
    this.shapeToColliderDesc.delete(shape);
    this.shapeTypeMap.delete(shape);
    this.shapeMaterialMap.delete(shape);
    this.shapeDensityMap.delete(shape);
  }

  // --- Shape filtering ---

  setShapeFilterMembershipMask(shape: PhysicsShape, membershipMask: number): void {
    this.shapeFilterMembership.set(shape, membershipMask);
  }

  getShapeFilterMembershipMask(shape: PhysicsShape): number {
    return this.shapeFilterMembership.get(shape) ?? 0xFFFFFFFF;
  }

  setShapeFilterCollideMask(shape: PhysicsShape, collideMask: number): void {
    this.shapeFilterCollide.set(shape, collideMask);
  }

  getShapeFilterCollideMask(shape: PhysicsShape): number {
    return this.shapeFilterCollide.get(shape) ?? 0xFFFFFFFF;
  }

  // --- Shape material ---

  setMaterial(shape: PhysicsShape, material: PhysicsMaterial): void {
    this.shapeMaterialMap.set(shape, material);
    // Apply to all colliders that use this shape — would need shape→body mapping
  }

  getMaterial(shape: PhysicsShape): PhysicsMaterial {
    return this.shapeMaterialMap.get(shape) ?? { friction: 0.5, restitution: 0 };
  }

  setDensity(shape: PhysicsShape, density: number): void {
    this.shapeDensityMap.set(shape, density);
  }

  getDensity(shape: PhysicsShape): number {
    return this.shapeDensityMap.get(shape) ?? 1.0;
  }

  // --- Compound shapes ---

  addChild(_shape: PhysicsShape, _newChild: PhysicsShape, _translation?: Vector3, _rotation?: Quaternion, _scale?: Vector3): void {
    // Compound shape support — stub
  }

  removeChild(_shape: PhysicsShape, _childIndex: number): void {
    // Compound shape support — stub
  }

  getNumChildren(_shape: PhysicsShape): number {
    return 0;
  }

  // --- Bounding box ---

  getBoundingBox(_shape: PhysicsShape): BoundingBox {
    return new BoundingBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  }

  getBodyBoundingBox(_body: PhysicsBody): BoundingBox {
    return new BoundingBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  }

  // --- Triggers & collision callbacks ---

  setTrigger(shape: PhysicsShape, isTrigger: boolean): void {
    if (isTrigger) {
      this.triggerShapes.add(shape);
    } else {
      this.triggerShapes.delete(shape);
    }
  }

  setCollisionCallbackEnabled(body: PhysicsBody, enabled: boolean, _instanceIndex?: number): void {
    if (enabled) {
      this.collisionCallbackEnabled.add(body);
    } else {
      this.collisionCallbackEnabled.delete(body);
    }
  }

  setCollisionEndedCallbackEnabled(body: PhysicsBody, enabled: boolean, _instanceIndex?: number): void {
    if (enabled) {
      this.collisionEndedCallbackEnabled.add(body);
    } else {
      this.collisionEndedCallbackEnabled.delete(body);
    }
  }

  // --- Event mask ---

  setEventMask(_body: PhysicsBody, _eventMask: number, _instanceIndex?: number): void {
    // Event mask stub
  }

  getEventMask(_body: PhysicsBody, _instanceIndex?: number): number {
    return 0;
  }

  // --- Motion type ---

  setMotionType(body: PhysicsBody, motionType: PhysicsMotionType, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    switch (motionType) {
      case PhysicsMotionType.DYNAMIC:
        rb.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
        break;
      case PhysicsMotionType.STATIC:
        rb.setBodyType(this.rapier.RigidBodyType.Fixed, true);
        break;
      case PhysicsMotionType.ANIMATED:
        rb.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
        break;
    }
  }

  getMotionType(body: PhysicsBody, _instanceIndex?: number): PhysicsMotionType {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return PhysicsMotionType.STATIC;

    if (rb.isDynamic()) return PhysicsMotionType.DYNAMIC;
    if (rb.isKinematic()) return PhysicsMotionType.ANIMATED;
    return PhysicsMotionType.STATIC;
  }

  // --- Mass properties ---

  computeMassProperties(_body: PhysicsBody, _instanceIndex?: number): PhysicsMassProperties {
    return { mass: 1, centerOfMass: Vector3.Zero(), inertia: Vector3.One(), inertiaOrientation: Quaternion.Identity() };
  }

  setMassProperties(body: PhysicsBody, massProps: PhysicsMassProperties, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;
    if (massProps.mass !== undefined) {
      rb.setAdditionalMass(massProps.mass, true);
    }
  }

  getMassProperties(_body: PhysicsBody, _instanceIndex?: number): PhysicsMassProperties {
    return { mass: 1, centerOfMass: Vector3.Zero(), inertia: Vector3.One(), inertiaOrientation: Quaternion.Identity() };
  }

  // --- Damping ---

  setLinearDamping(body: PhysicsBody, damping: number, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) rb.setLinearDamping(damping);
  }

  getLinearDamping(body: PhysicsBody, _instanceIndex?: number): number {
    const rb = this.bodyToRigidBody.get(body);
    return rb?.linearDamping() ?? 0;
  }

  setAngularDamping(body: PhysicsBody, damping: number, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) rb.setAngularDamping(damping);
  }

  getAngularDamping(body: PhysicsBody, _instanceIndex?: number): number {
    const rb = this.bodyToRigidBody.get(body);
    return rb?.angularDamping() ?? 0;
  }

  // --- Velocity ---

  setLinearVelocity(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) rb.setLinvel(new this.rapier.Vector3(linVel.x, linVel.y, linVel.z), true);
  }

  getLinearVelocityToRef(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) {
      const v = rb.linvel();
      linVel.set(v.x, v.y, v.z);
    }
  }

  setAngularVelocity(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) rb.setAngvel(new this.rapier.Vector3(angVel.x, angVel.y, angVel.z), true);
  }

  getAngularVelocityToRef(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) {
      const v = rb.angvel();
      angVel.set(v.x, v.y, v.z);
    }
  }

  // --- Forces & impulses ---

  applyImpulse(body: PhysicsBody, impulse: Vector3, location: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    rb.applyImpulseAtPoint(
      new this.rapier.Vector3(impulse.x, impulse.y, impulse.z),
      new this.rapier.Vector3(location.x, location.y, location.z),
      true
    );
  }

  applyAngularImpulse(body: PhysicsBody, angularImpulse: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;
    rb.applyTorqueImpulse(new this.rapier.Vector3(angularImpulse.x, angularImpulse.y, angularImpulse.z), true);
  }

  applyForce(body: PhysicsBody, force: Vector3, location: Vector3, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    rb.addForceAtPoint(
      new this.rapier.Vector3(force.x, force.y, force.z),
      new this.rapier.Vector3(location.x, location.y, location.z),
      true
    );
  }

  // --- Gravity factor ---

  setGravityFactor(body: PhysicsBody, factor: number, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (rb) rb.setGravityScale(factor, true);
  }

  getGravityFactor(body: PhysicsBody, _instanceIndex?: number): number {
    const rb = this.bodyToRigidBody.get(body);
    return rb?.gravityScale() ?? 1;
  }

  // --- Target transform (kinematic) ---

  setTargetTransform(body: PhysicsBody, position: Vector3, rotation: Quaternion, _instanceIndex?: number): void {
    const rb = this.bodyToRigidBody.get(body);
    if (!rb) return;

    rb.setNextKinematicTranslation(new this.rapier.Vector3(position.x, position.y, position.z));
    rb.setNextKinematicRotation(new this.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
  }

  // --- Body geometry ---

  getBodyGeometry(_body: PhysicsBody): {} {
    return {};
  }

  // --- Constraints ---

  private buildConstraintDescriptor(constraint: PhysicsConstraint): ConstraintDescriptor {
    const opts = (constraint as any)._options ?? {};
    const cType = (constraint as any)._type as PhysicsConstraintType;

    let type: ConstraintDescriptor['type'];
    switch (cType) {
      case PhysicsConstraintType.BALL_AND_SOCKET: type = 'ball_and_socket'; break;
      case PhysicsConstraintType.DISTANCE: type = 'distance'; break;
      case PhysicsConstraintType.HINGE: type = 'hinge'; break;
      case PhysicsConstraintType.SLIDER: type = 'slider'; break;
      case PhysicsConstraintType.LOCK: type = 'lock'; break;
      case PhysicsConstraintType.PRISMATIC: type = 'prismatic'; break;
      case PhysicsConstraintType.SIX_DOF: type = 'six_dof'; break;
      default: type = 'ball_and_socket';
    }

    // Detect spring: a 6DOF with stiffness/damping in limits
    const sixDofLimits = (constraint as any).limits as Array<{ axis: number; minLimit?: number; maxLimit?: number; stiffness?: number; damping?: number }> | undefined;
    let isSpring = false;
    if (type === 'six_dof' && sixDofLimits) {
      isSpring = sixDofLimits.some(l => l.stiffness !== undefined && l.stiffness > 0);
    }

    const desc: ConstraintDescriptor = {
      id: '', // caller sets this
      bodyIdA: '',
      bodyIdB: '',
      type: isSpring ? 'spring' : type,
      pivotA: opts.pivotA ? v3toVec(opts.pivotA) : undefined,
      pivotB: opts.pivotB ? v3toVec(opts.pivotB) : undefined,
      axisA: opts.axisA ? v3toVec(opts.axisA) : undefined,
      axisB: opts.axisB ? v3toVec(opts.axisB) : undefined,
      perpAxisA: opts.perpAxisA ? v3toVec(opts.perpAxisA) : undefined,
      perpAxisB: opts.perpAxisB ? v3toVec(opts.perpAxisB) : undefined,
      maxDistance: opts.maxDistance,
      collision: opts.collision,
    };

    if (isSpring && sixDofLimits) {
      const springLimit = sixDofLimits.find(l => l.stiffness !== undefined);
      if (springLimit) {
        desc.stiffness = springLimit.stiffness;
        desc.damping = springLimit.damping;
      }
    }

    if (type === 'six_dof' && !isSpring && sixDofLimits) {
      desc.limits = sixDofLimits.map(l => ({
        axis: l.axis,
        minLimit: l.minLimit,
        maxLimit: l.maxLimit,
      }));
    }

    return desc;
  }

  private createJointFromConstraint(constraint: PhysicsConstraint, rbA: RAPIER.RigidBody, rbB: RAPIER.RigidBody): RAPIER.ImpulseJoint {
    const desc = this.buildConstraintDescriptor(constraint);
    const jointData = createJointData(this.rapier, desc);
    return this.world.createImpulseJoint(jointData, rbA, rbB, true);
  }

  initConstraint(constraint: PhysicsConstraint, body: PhysicsBody, childBody: PhysicsBody): void {
    if (this.constraintToJoint.has(constraint)) return;

    const rbA = this.bodyToRigidBody.get(body);
    const rbB = this.bodyToRigidBody.get(childBody);
    if (!rbA || !rbB) return;

    const joint = this.createJointFromConstraint(constraint, rbA, rbB);
    this.constraintToJoint.set(constraint, joint);
    this.constraintBodies.set(constraint, { body, childBody });
    this.constraintEnabled.set(constraint, true);

    // Apply collision setting
    const opts = (constraint as any)._options;
    if (opts?.collision === false) {
      joint.setContactsEnabled(false);
    }

    // Apply initial limits for hinge/slider
    this.applyInitialLimits(constraint, joint);
  }

  private applyInitialLimits(constraint: PhysicsConstraint, joint: RAPIER.ImpulseJoint): void {
    const sixDofLimits = (constraint as any).limits as Array<{ axis: number; minLimit?: number; maxLimit?: number }> | undefined;
    if (!sixDofLimits) return;

    const cType = (constraint as any)._type as PhysicsConstraintType;
    if (cType === PhysicsConstraintType.HINGE) {
      // Revolute joint — apply angular X limits
      const angLim = sixDofLimits.find(l => l.axis === PhysicsConstraintAxis.ANGULAR_X);
      if (angLim && angLim.minLimit !== undefined && angLim.maxLimit !== undefined) {
        (joint as any).setLimits?.(angLim.minLimit, angLim.maxLimit);
      }
    } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
      // Prismatic joint — apply linear X limits
      const linLim = sixDofLimits.find(l => l.axis === PhysicsConstraintAxis.LINEAR_X);
      if (linLim && linLim.minLimit !== undefined && linLim.maxLimit !== undefined) {
        (joint as any).setLimits?.(linLim.minLimit, linLim.maxLimit);
      }
    }
  }

  addConstraint(body: PhysicsBody, childBody: PhysicsBody, constraint: PhysicsConstraint, _instanceIndex?: number, _childInstanceIndex?: number): void {
    if (!this.constraintToJoint.has(constraint)) {
      this.initConstraint(constraint, body, childBody);
    }
  }

  disposeConstraint(constraint: PhysicsConstraint): void {
    const joint = this.constraintToJoint.get(constraint);
    if (joint) {
      this.world.removeImpulseJoint(joint, true);
      this.constraintToJoint.delete(constraint);
    }
    this.constraintBodies.delete(constraint);
    this.constraintAxisState.delete(constraint);
    this.constraintEnabled.delete(constraint);
    this.constraintDescriptors.delete(constraint);
  }

  setEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    const currentlyEnabled = this.constraintEnabled.get(constraint) ?? true;
    if (isEnabled === currentlyEnabled) return;

    if (!isEnabled) {
      // Disable: remove the joint
      const joint = this.constraintToJoint.get(constraint);
      if (joint) {
        this.world.removeImpulseJoint(joint, true);
        this.constraintToJoint.delete(constraint);
      }
      this.constraintEnabled.set(constraint, false);
    } else {
      // Enable: re-create the joint
      const pair = this.constraintBodies.get(constraint);
      if (pair) {
        const rbA = this.bodyToRigidBody.get(pair.body);
        const rbB = this.bodyToRigidBody.get(pair.childBody);
        if (rbA && rbB) {
          const joint = this.createJointFromConstraint(constraint, rbA, rbB);
          this.constraintToJoint.set(constraint, joint);

          const opts = (constraint as any)._options;
          if (opts?.collision === false) {
            joint.setContactsEnabled(false);
          }
        }
      }
      this.constraintEnabled.set(constraint, true);
    }
  }

  getEnabled(constraint: PhysicsConstraint): boolean {
    return this.constraintEnabled.get(constraint) ?? true;
  }

  setCollisionsEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    const joint = this.constraintToJoint.get(constraint);
    if (joint) {
      joint.setContactsEnabled(isEnabled);
    }
  }

  getCollisionsEnabled(constraint: PhysicsConstraint): boolean {
    const joint = this.constraintToJoint.get(constraint);
    if (joint) {
      return joint.contactsEnabled();
    }
    return true;
  }

  private ensureAxisConfig(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): AxisConfig {
    let axisMap = this.constraintAxisState.get(constraint);
    if (!axisMap) {
      axisMap = new Map();
      this.constraintAxisState.set(constraint, axisMap);
    }
    let config = axisMap.get(axis);
    if (!config) {
      config = {};
      axisMap.set(axis, config);
    }
    return config;
  }

  private getAxisConfig(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): AxisConfig | undefined {
    return this.constraintAxisState.get(constraint)?.get(axis);
  }

  setAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, friction: number): void {
    this.ensureAxisConfig(constraint, axis).friction = friction;
  }

  getAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
    return this.getAxisConfig(constraint, axis)?.friction ?? null;
  }

  setAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limitMode: PhysicsConstraintAxisLimitMode): void {
    this.ensureAxisConfig(constraint, axis).mode = limitMode;
    this.applyAxisLimitsToJoint(constraint, axis);
  }

  getAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintAxisLimitMode> {
    return this.getAxisConfig(constraint, axis)?.mode ?? null;
  }

  setAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, minLimit: number): void {
    this.ensureAxisConfig(constraint, axis).minLimit = minLimit;
    this.applyAxisLimitsToJoint(constraint, axis);
  }

  getAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
    return this.getAxisConfig(constraint, axis)?.minLimit ?? null;
  }

  setAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limit: number): void {
    this.ensureAxisConfig(constraint, axis).maxLimit = limit;
    this.applyAxisLimitsToJoint(constraint, axis);
  }

  getAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
    return this.getAxisConfig(constraint, axis)?.maxLimit ?? null;
  }

  private applyAxisLimitsToJoint(constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): void {
    const joint = this.constraintToJoint.get(constraint);
    if (!joint) return;

    const cType = (constraint as any)._type as PhysicsConstraintType;

    // For single-DOF joints (hinge/slider), apply limits directly
    if (cType === PhysicsConstraintType.HINGE) {
      const angConfig = this.getAxisConfig(constraint, PhysicsConstraintAxis.ANGULAR_X);
      if (angConfig?.minLimit !== undefined && angConfig?.maxLimit !== undefined) {
        (joint as any).setLimits?.(angConfig.minLimit, angConfig.maxLimit);
      }
    } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
      const linConfig = this.getAxisConfig(constraint, PhysicsConstraintAxis.LINEAR_X);
      if (linConfig?.minLimit !== undefined && linConfig?.maxLimit !== undefined) {
        (joint as any).setLimits?.(linConfig.minLimit, linConfig.maxLimit);
      }
    }
  }

  setAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, motorType: PhysicsConstraintMotorType): void {
    this.ensureAxisConfig(constraint, axis).motorType = motorType;
    this.applyMotorToJoint(constraint);
  }

  getAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintMotorType> {
    return this.getAxisConfig(constraint, axis)?.motorType ?? null;
  }

  setAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, target: number): void {
    this.ensureAxisConfig(constraint, axis).motorTarget = target;
    this.applyMotorToJoint(constraint);
  }

  getAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
    return this.getAxisConfig(constraint, axis)?.motorTarget ?? null;
  }

  setAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, maxForce: number): void {
    this.ensureAxisConfig(constraint, axis).motorMaxForce = maxForce;
    this.applyMotorToJoint(constraint);
  }

  getAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
    return this.getAxisConfig(constraint, axis)?.motorMaxForce ?? null;
  }

  private applyMotorToJoint(constraint: PhysicsConstraint): void {
    const joint = this.constraintToJoint.get(constraint);
    if (!joint) return;

    const cType = (constraint as any)._type as PhysicsConstraintType;

    if (cType === PhysicsConstraintType.HINGE) {
      const config = this.getAxisConfig(constraint, PhysicsConstraintAxis.ANGULAR_X);
      if (config?.motorTarget !== undefined) {
        const maxForce = config.motorMaxForce ?? 1000;
        if (config.motorType === PhysicsConstraintMotorType.VELOCITY) {
          (joint as any).configureMotorVelocity?.(config.motorTarget, maxForce);
        } else {
          (joint as any).configureMotorPosition?.(config.motorTarget, maxForce, 0);
        }
      }
    } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
      const config = this.getAxisConfig(constraint, PhysicsConstraintAxis.LINEAR_X);
      if (config?.motorTarget !== undefined) {
        const maxForce = config.motorMaxForce ?? 1000;
        if (config.motorType === PhysicsConstraintMotorType.VELOCITY) {
          (joint as any).configureMotorVelocity?.(config.motorTarget, maxForce);
        } else {
          (joint as any).configureMotorPosition?.(config.motorTarget, maxForce, 0);
        }
      }
    }
  }

  getBodiesUsingConstraint(constraint: PhysicsConstraint): ConstrainedBodyPair[] {
    const pair = this.constraintBodies.get(constraint);
    if (!pair) return [];
    return [{
      parentBody: pair.body,
      parentBodyIndex: 0,
      childBody: pair.childBody,
      childBodyIndex: 0,
    }];
  }

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

  raycast(from: Vector3, to: Vector3, result: PhysicsRaycastResult, _query?: IRaycastQuery): void {
    const dir = to.subtract(from);
    const maxToi = dir.length();
    const normalizedDir = dir.normalize();

    const ray = new this.rapier.Ray(
      new this.rapier.Vector3(from.x, from.y, from.z),
      new this.rapier.Vector3(normalizedDir.x, normalizedDir.y, normalizedDir.z)
    );

    const hit = this.world.castRay(ray, maxToi, true);
    if (hit) {
      const hitPoint = ray.pointAt(hit.timeOfImpact);
      result.setHitData(
        new Vector3(hitPoint.x, hitPoint.y, hitPoint.z),
        new Vector3(0, 1, 0) // Normal approximation
      );
      result.calculateHitDistance();
    }
  }

  // --- Dispose ---

  dispose(): void {
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
    for (const event of events) {
      const bodyA = this.bodyIdToPhysicsBody.get(event.bodyIdA);
      const bodyB = this.bodyIdToPhysicsBody.get(event.bodyIdB);
      if (!bodyA || !bodyB) continue;

      const point = event.point ? new Vector3(event.point.x, event.point.y, event.point.z) : null;
      const normal = event.normal ? new Vector3(event.normal.x, event.normal.y, event.normal.z) : null;

      const eventType = PhysicsEventType[event.type as keyof typeof PhysicsEventType];

      const baseEventA: IBasePhysicsCollisionEvent = {
        collider: bodyA,
        collidedAgainst: bodyB,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };

      const baseEventB: IBasePhysicsCollisionEvent = {
        collider: bodyB,
        collidedAgainst: bodyA,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };

      switch (event.type) {
        case 'COLLISION_STARTED': {
          const fullEventA: IPhysicsCollisionEvent = {
            ...baseEventA,
            point,
            normal,
            distance: 0,
            impulse: event.impulse,
          };
          const fullEventB: IPhysicsCollisionEvent = {
            ...baseEventB,
            point,
            normal: normal ? normal.negate() : null,
            distance: 0,
            impulse: event.impulse,
          };

          this.onCollisionObservable.notifyObservers(fullEventA);

          if (this.collisionCallbackEnabled.has(bodyA)) {
            this.bodyCollisionObservables.get(bodyA)?.notifyObservers(fullEventA);
          }
          if (this.collisionCallbackEnabled.has(bodyB)) {
            this.bodyCollisionObservables.get(bodyB)?.notifyObservers(fullEventB);
          }
          break;
        }
        case 'COLLISION_FINISHED': {
          this.onCollisionEndedObservable.notifyObservers(baseEventA);

          if (this.collisionEndedCallbackEnabled.has(bodyA)) {
            this.bodyCollisionEndedObservables.get(bodyA)?.notifyObservers(baseEventA);
          }
          if (this.collisionEndedCallbackEnabled.has(bodyB)) {
            this.bodyCollisionEndedObservables.get(bodyB)?.notifyObservers(baseEventB);
          }
          break;
        }
        case 'TRIGGER_ENTERED':
        case 'TRIGGER_EXITED': {
          this.onTriggerCollisionObservable.notifyObservers(baseEventA);

          // Fire per-body observables for triggers via collision observables
          if (this.collisionCallbackEnabled.has(bodyA)) {
            const triggerEventA: IPhysicsCollisionEvent = {
              ...baseEventA,
              point: null,
              normal: null,
              distance: 0,
              impulse: 0,
            };
            this.bodyCollisionObservables.get(bodyA)?.notifyObservers(triggerEventA);
          }
          if (this.collisionCallbackEnabled.has(bodyB)) {
            const triggerEventB: IPhysicsCollisionEvent = {
              ...baseEventB,
              point: null,
              normal: null,
              distance: 0,
              impulse: 0,
            };
            this.bodyCollisionObservables.get(bodyB)?.notifyObservers(triggerEventB);
          }
          break;
        }
      }
    }
  }
}
