import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Observable,
  PhysicsBody,
  PhysicsShape,
  PhysicsConstraint,
  PhysicsMaterial,
  PhysicsShapeType,
  IPhysicsCollisionEvent,
  IBasePhysicsCollisionEvent,
} from '@babylonjs/core';
import type { Vector3, Quaternion } from '@babylonjs/core';
import type { Vec3 } from '@rapierphysicsplugin/shared';
import { PhysicsConstraintAxisLimitMode, PhysicsConstraintMotorType } from '@babylonjs/core';

export interface AxisConfig {
  mode?: PhysicsConstraintAxisLimitMode;
  minLimit?: number;
  maxLimit?: number;
  friction?: number;
  motorType?: PhysicsConstraintMotorType;
  motorTarget?: number;
  motorMaxForce?: number;
}

export function v3toVec(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export interface ShapeRawData {
  vertices?: Float32Array;
  indices?: Uint32Array;
  heights?: Float32Array;
  nrows?: number;
  ncols?: number;
  sizeX?: number;
  sizeZ?: number;
}

export interface RapierPluginState {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  bodyToRigidBody: Map<PhysicsBody, RAPIER.RigidBody>;
  bodyToColliders: Map<PhysicsBody, RAPIER.Collider[]>;
  shapeToColliderDesc: Map<PhysicsShape, RAPIER.ColliderDesc>;
  shapeTypeMap: Map<PhysicsShape, PhysicsShapeType>;
  shapeMaterialMap: Map<PhysicsShape, PhysicsMaterial>;
  shapeDensityMap: Map<PhysicsShape, number>;
  shapeFilterMembership: Map<PhysicsShape, number>;
  shapeFilterCollide: Map<PhysicsShape, number>;
  shapeRawData: Map<PhysicsShape, ShapeRawData>;
  bodyCollisionObservables: Map<PhysicsBody, Observable<IPhysicsCollisionEvent>>;
  bodyCollisionEndedObservables: Map<PhysicsBody, Observable<IBasePhysicsCollisionEvent>>;
  constraintToJoint: Map<PhysicsConstraint, RAPIER.ImpulseJoint>;
  constraintBodies: Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>;
  constraintAxisState: Map<PhysicsConstraint, Map<number, AxisConfig>>;
  constraintEnabled: Map<PhysicsConstraint, boolean>;
  constraintDescriptors: Map<PhysicsConstraint, { body: PhysicsBody; childBody: PhysicsBody }>;
  collisionCallbackEnabled: Set<PhysicsBody>;
  collisionEndedCallbackEnabled: Set<PhysicsBody>;
  triggerShapes: Set<PhysicsShape>;
  bodyIdToPhysicsBody: Map<string, PhysicsBody>;
  bodyToShape: Map<PhysicsBody, PhysicsShape>;
  shapeToBody: Map<PhysicsShape, PhysicsBody>;
  compoundChildren: Map<PhysicsShape, Array<{ child: PhysicsShape; translation?: Vector3; rotation?: Quaternion; scale?: Vector3 }>>;
  bodyEventMask: Map<PhysicsBody, number>;
  colliderHandleToBody: Map<number, PhysicsBody>;
  activeCollisionPairs: Set<string>;
  onCollisionObservable: Observable<IPhysicsCollisionEvent>;
  onCollisionEndedObservable: Observable<IBasePhysicsCollisionEvent>;
  onTriggerCollisionObservable: Observable<IBasePhysicsCollisionEvent>;
}
