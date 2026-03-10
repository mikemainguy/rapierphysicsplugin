import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  BodyState,
  CollisionEventData,
  ConstraintDescriptor,
  ConstraintUpdates,
  Vec3,
  Quat,
  InputAction,
  ShapeCastRequest,
  ShapeCastResponse,
  ShapeProximityRequest,
  ShapeProximityResponse,
  PointProximityRequest,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import { FIXED_TIMESTEP } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';
import {
  addBody as addBodyFn,
  removeBody as removeBodyFn,
  applyForce as applyForceFn,
  applyImpulse as applyImpulseFn,
  setBodyVelocity as setBodyVelocityFn,
  setBodyPosition as setBodyPositionFn,
  setBodyRotation as setBodyRotationFn,
} from './pw-body-ops.js';
import { applyInput as applyInputFn } from './pw-input.js';
import {
  addConstraint as addConstraintFn,
  removeConstraint as removeConstraintFn,
  updateConstraint as updateConstraintFn,
  hasConstraint as hasConstraintFn,
} from './pw-constraints.js';
import { stepWorld } from './pw-collisions.js';
import {
  getSnapshot as getSnapshotFn,
  getBodyState as getBodyStateFn,
  isBodySleeping as isBodySleepingFn,
  loadState as loadStateFn,
  resetWorld,
  hasBody as hasBodyFn,
  getBodyCount,
} from './pw-state.js';
import { shapeCast as shapeCastFn, shapeProximity as shapeProximityFn, pointProximity as pointProximityFn } from './pw-queries.js';

export class PhysicsWorld {
  private ctx: PhysicsWorldContext;

  constructor(rapier: typeof RAPIER, gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
    const world = new rapier.World({ x: gravity.x, y: gravity.y, z: gravity.z });
    world.timestep = FIXED_TIMESTEP;

    this.ctx = {
      rapier,
      world,
      bodyMap: new Map(),
      colliderMap: new Map(),
      colliderHandleToBodyId: new Map(),
      constraintMap: new Map(),
      activeCollisionPairs: new Set(),
      eventQueue: new rapier.EventQueue(true),
    };
  }

  // --- Body operations ---

  addBody(descriptor: BodyDescriptor): string { return addBodyFn(this.ctx, descriptor); }
  removeBody(id: string): void { removeBodyFn(this.ctx, id); }
  applyForce(id: string, force: Vec3, point?: Vec3): void { applyForceFn(this.ctx, id, force, point); }
  applyImpulse(id: string, impulse: Vec3, point?: Vec3): void { applyImpulseFn(this.ctx, id, impulse, point); }
  setBodyVelocity(id: string, linVel: Vec3, angVel?: Vec3): void { setBodyVelocityFn(this.ctx, id, linVel, angVel); }
  setBodyPosition(id: string, position: Vec3): void { setBodyPositionFn(this.ctx, id, position); }
  setBodyRotation(id: string, rotation: Quat): void { setBodyRotationFn(this.ctx, id, rotation); }

  // --- Input ---

  applyInput(action: InputAction): void { applyInputFn(this.ctx, action); }

  // --- Constraints ---

  addConstraint(descriptor: ConstraintDescriptor): string { return addConstraintFn(this.ctx, descriptor); }
  removeConstraint(id: string): void { removeConstraintFn(this.ctx, id); }
  updateConstraint(id: string, updates: ConstraintUpdates): void { updateConstraintFn(this.ctx, id, updates); }
  hasConstraint(id: string): boolean { return hasConstraintFn(this.ctx, id); }

  // --- Simulation step ---

  step(): CollisionEventData[] { return stepWorld(this.ctx); }

  // --- State ---

  getSnapshot(skipSleeping = false): BodyState[] { return getSnapshotFn(this.ctx, skipSleeping); }
  getBodyState(id: string): BodyState | null { return getBodyStateFn(this.ctx, id); }
  isBodySleeping(id: string): boolean { return isBodySleepingFn(this.ctx, id); }
  loadState(bodies: BodyDescriptor[]): void { loadStateFn(this.ctx, bodies); }
  reset(bodies: BodyDescriptor[], constraints?: ConstraintDescriptor[]): void { resetWorld(this.ctx, bodies, constraints); }
  hasBody(id: string): boolean { return hasBodyFn(this.ctx, id); }
  get bodyCount(): number { return getBodyCount(this.ctx); }

  // --- Shape queries ---

  shapeCast(request: ShapeCastRequest): ShapeCastResponse { return shapeCastFn(this.ctx, request); }
  shapeProximity(request: ShapeProximityRequest): ShapeProximityResponse { return shapeProximityFn(this.ctx, request); }
  pointProximity(request: PointProximityRequest): PointProximityResponse { return pointProximityFn(this.ctx, request); }

  // --- Lifecycle ---

  destroy(): void {
    this.ctx.constraintMap.clear();
    this.ctx.activeCollisionPairs.clear();
    this.ctx.eventQueue.free();
    this.ctx.world.free();
    this.ctx.bodyMap.clear();
    this.ctx.colliderMap.clear();
    this.ctx.colliderHandleToBodyId.clear();
  }
}
