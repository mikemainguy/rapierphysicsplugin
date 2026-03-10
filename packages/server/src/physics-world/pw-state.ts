import type { BodyDescriptor, BodyState, ConstraintDescriptor } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';
import { addBody, removeBody } from './pw-body-ops.js';
import { addConstraint } from './pw-constraints.js';

export function getSnapshot(ctx: PhysicsWorldContext, skipSleeping = false): BodyState[] {
  const states: BodyState[] = [];
  for (const [id, body] of ctx.bodyMap) {
    if (skipSleeping && body.isSleeping()) continue;
    const pos = body.translation();
    const rot = body.rotation();
    const linVel = body.linvel();
    const angVel = body.angvel();
    states.push({
      id,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      linVel: { x: linVel.x, y: linVel.y, z: linVel.z },
      angVel: { x: angVel.x, y: angVel.y, z: angVel.z },
    });
  }
  return states;
}

export function getBodyState(ctx: PhysicsWorldContext, id: string): BodyState | null {
  const body = ctx.bodyMap.get(id);
  if (!body) return null;

  const pos = body.translation();
  const rot = body.rotation();
  const linVel = body.linvel();
  const angVel = body.angvel();
  return {
    id,
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    linVel: { x: linVel.x, y: linVel.y, z: linVel.z },
    angVel: { x: angVel.x, y: angVel.y, z: angVel.z },
  };
}

export function isBodySleeping(ctx: PhysicsWorldContext, id: string): boolean {
  const body = ctx.bodyMap.get(id);
  return body ? body.isSleeping() : false;
}

export function loadState(ctx: PhysicsWorldContext, bodies: BodyDescriptor[]): void {
  for (const body of bodies) {
    addBody(ctx, body);
  }
}

export function resetWorld(
  ctx: PhysicsWorldContext,
  bodies: BodyDescriptor[],
  constraints?: ConstraintDescriptor[],
): void {
  // Remove all existing constraints first (joints reference bodies)
  for (const [, joint] of ctx.constraintMap) {
    ctx.world.removeImpulseJoint(joint, true);
  }
  ctx.constraintMap.clear();

  // Remove all existing bodies
  for (const [id] of ctx.bodyMap) {
    removeBody(ctx, id);
  }
  ctx.activeCollisionPairs.clear();

  // Reload from descriptors
  loadState(ctx, bodies);

  // Re-create constraints
  if (constraints) {
    for (const c of constraints) {
      addConstraint(ctx, c);
    }
  }
}

export function hasBody(ctx: PhysicsWorldContext, id: string): boolean {
  return ctx.bodyMap.has(id);
}

export function getBodyCount(ctx: PhysicsWorldContext): number {
  return ctx.bodyMap.size;
}
