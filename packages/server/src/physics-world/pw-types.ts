import type RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsWorldContext {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  bodyMap: Map<string, RAPIER.RigidBody>;
  colliderMap: Map<string, RAPIER.Collider[]>;
  colliderHandleToBodyId: Map<number, string>;
  constraintMap: Map<string, RAPIER.ImpulseJoint>;
  activeCollisionPairs: Set<string>;
  eventQueue: RAPIER.EventQueue;
}
