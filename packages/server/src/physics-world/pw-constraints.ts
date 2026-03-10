import type { ConstraintDescriptor, ConstraintUpdates } from '@rapierphysicsplugin/shared';
import { createJointData } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';

export function addConstraint(ctx: PhysicsWorldContext, descriptor: ConstraintDescriptor): string {
  const { id, bodyIdA, bodyIdB } = descriptor;

  if (ctx.constraintMap.has(id)) {
    throw new Error(`Constraint with id "${id}" already exists`);
  }

  const rbA = ctx.bodyMap.get(bodyIdA);
  const rbB = ctx.bodyMap.get(bodyIdB);
  if (!rbA) throw new Error(`Body "${bodyIdA}" not found for constraint "${id}"`);
  if (!rbB) throw new Error(`Body "${bodyIdB}" not found for constraint "${id}"`);

  const jointData = createJointData(ctx.rapier, descriptor);
  const joint = ctx.world.createImpulseJoint(jointData, rbA, rbB, true);

  if (descriptor.collision === false) {
    joint.setContactsEnabled(false);
  }

  ctx.constraintMap.set(id, joint);
  return id;
}

export function removeConstraint(ctx: PhysicsWorldContext, id: string): void {
  const joint = ctx.constraintMap.get(id);
  if (!joint) return;
  ctx.world.removeImpulseJoint(joint, true);
  ctx.constraintMap.delete(id);
}

export function updateConstraint(ctx: PhysicsWorldContext, id: string, updates: ConstraintUpdates): void {
  const joint = ctx.constraintMap.get(id);
  if (!joint) return;

  if (updates.enabled !== undefined) {
    (joint as any).setEnabled?.(updates.enabled);
  }
  if (updates.collisionsEnabled !== undefined) {
    joint.setContactsEnabled(updates.collisionsEnabled);
  }
  if (updates.axisUpdates) {
    for (const au of updates.axisUpdates) {
      if (au.minLimit !== undefined && au.maxLimit !== undefined) {
        (joint as any).setLimits?.(au.minLimit, au.maxLimit);
      }
      if (au.motorTarget !== undefined) {
        const maxForce = au.motorMaxForce ?? 1000;
        if (au.motorType === 1) { // velocity
          (joint as any).configureMotorVelocity?.(au.motorTarget, maxForce);
        } else {
          (joint as any).configureMotorPosition?.(au.motorTarget, maxForce, 0);
        }
      }
    }
  }
}

export function hasConstraint(ctx: PhysicsWorldContext, id: string): boolean {
  return ctx.constraintMap.has(id);
}
