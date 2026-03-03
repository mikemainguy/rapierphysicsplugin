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
import type {
  PhysicsMotionType,
  PhysicsShapeType,
  PhysicsConstraintAxisLimitMode,
  PhysicsConstraintMotorType,
  PhysicsConstraintAxis,
} from '@babylonjs/core';
import type { Mesh, TransformNode, Nullable } from '@babylonjs/core';
import type { CollisionEventData } from '@rapierphysicsplugin/shared';
import type { AxisConfig } from './rapier-types.js';

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

  // --- Gravity factor ---

  setGravityFactor(body: PhysicsBody, factor: number, _instanceIndex?: number): void { bodyOps.setGravityFactor(this, body, factor); }
  getGravityFactor(body: PhysicsBody, _instanceIndex?: number): number { return bodyOps.getGravityFactor(this, body); }

  // --- Target transform (kinematic) ---

  setTargetTransform(body: PhysicsBody, position: Vector3, rotation: Quaternion, _instanceIndex?: number): void {
    bodyOps.setTargetTransform(this, body, position, rotation);
  }

  // --- Body geometry ---

  getBodyGeometry(_body: PhysicsBody): {} { return {}; }

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

  raycast(from: Vector3, to: Vector3, result: PhysicsRaycastResult, _query?: IRaycastQuery): void {
    const dir = to.subtract(from);
    const maxToi = dir.length();
    const normalizedDir = dir.normalize();

    const ray = new this.rapier.Ray(
      new this.rapier.Vector3(from.x, from.y, from.z),
      new this.rapier.Vector3(normalizedDir.x, normalizedDir.y, normalizedDir.z)
    );

    const hit = this.world.castRayAndGetNormal(ray, maxToi, true);
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
    this.shapeFilterMembership.clear();
    this.shapeFilterCollide.clear();
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
