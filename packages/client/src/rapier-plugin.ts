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
} from '@babylonjs/core';
import type { Mesh, TransformNode, Nullable } from '@babylonjs/core';

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

  setTrigger(_shape: PhysicsShape, _isTrigger: boolean): void {
    // Would set collider as sensor in Rapier
  }

  setCollisionCallbackEnabled(_body: PhysicsBody, _enabled: boolean, _instanceIndex?: number): void {
    // Collision callback registration
  }

  setCollisionEndedCallbackEnabled(_body: PhysicsBody, _enabled: boolean, _instanceIndex?: number): void {
    // Collision ended callback registration
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

  initConstraint(_constraint: PhysicsConstraint, _body: PhysicsBody, _childBody: PhysicsBody): void {
    // Basic constraint initialization — stub
  }

  addConstraint(_body: PhysicsBody, _childBody: PhysicsBody, _constraint: PhysicsConstraint, _instanceIndex?: number, _childInstanceIndex?: number): void {
    // Add constraint — stub
  }

  disposeConstraint(constraint: PhysicsConstraint): void {
    const joint = this.constraintToJoint.get(constraint);
    if (joint) {
      this.world.removeImpulseJoint(joint, true);
      this.constraintToJoint.delete(constraint);
    }
  }

  setEnabled(_constraint: PhysicsConstraint, _isEnabled: boolean): void {}
  getEnabled(_constraint: PhysicsConstraint): boolean { return true; }
  setCollisionsEnabled(_constraint: PhysicsConstraint, _isEnabled: boolean): void {}
  getCollisionsEnabled(_constraint: PhysicsConstraint): boolean { return true; }

  setAxisFriction(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _friction: number): void {}
  getAxisFriction(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<number> { return null; }
  setAxisMode(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _limitMode: PhysicsConstraintAxisLimitMode): void {}
  getAxisMode(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintAxisLimitMode> { return null; }
  setAxisMinLimit(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _minLimit: number): void {}
  getAxisMinLimit(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<number> { return null; }
  setAxisMaxLimit(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _limit: number): void {}
  getAxisMaxLimit(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<number> { return null; }
  setAxisMotorType(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _motorType: PhysicsConstraintMotorType): void {}
  getAxisMotorType(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintMotorType> { return null; }
  setAxisMotorTarget(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _target: number): void {}
  getAxisMotorTarget(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<number> { return null; }
  setAxisMotorMaxForce(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis, _maxForce: number): void {}
  getAxisMotorMaxForce(_constraint: PhysicsConstraint, _axis: PhysicsConstraintAxis): Nullable<number> { return null; }

  getBodiesUsingConstraint(_constraint: PhysicsConstraint): ConstrainedBodyPair[] {
    return [];
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
}
