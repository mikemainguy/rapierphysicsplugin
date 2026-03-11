import type { ConstraintDescriptor, ConstraintUpdates } from '@rapierphysicsplugin/shared';
import { createJointData } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';

/** Tracks per-joint motor config so independent updates (target, maxForce) can be applied without re-sending motorType. */
interface MotorConfig { type: number; target: number; stiffness: number; damping: number; friction: number }
const motorConfigs = new WeakMap<object, MotorConfig>();

function applyMotor(joint: object, config: MotorConfig): void {
  if (config.type === 1) { // velocity
    (joint as any).configureMotorVelocity?.(config.target, config.damping);
  } else if (config.type === 2) { // position
    (joint as any).configureMotorPosition?.(config.target, config.stiffness, config.damping);
  } else if (config.friction > 0) {
    // NONE with friction — velocity motor targeting 0, friction as damping
    (joint as any).configureMotorVelocity?.(0, config.friction);
  } else {
    // NONE, no friction — fully neutralize
    (joint as any).configureMotor?.(0, 0, 0, 0);
    (joint as any).setMotorMaxForce?.(0);
  }
}

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
      if (au.motorType !== undefined) {
        const config: MotorConfig = {
          type: au.motorType,
          target: au.motorTarget ?? 0,
          stiffness: au.stiffness ?? 1000,
          damping: au.damping ?? 100,
          friction: au.friction ?? motorConfigs.get(joint)?.friction ?? 0,
        };
        motorConfigs.set(joint, config);
        applyMotor(joint, config);
      } else if (au.motorTarget !== undefined) {
        const config = motorConfigs.get(joint);
        if (config) {
          config.target = au.motorTarget;
          applyMotor(joint, config);
        }
      }
      if (au.friction !== undefined) {
        const config = motorConfigs.get(joint);
        if (config) {
          config.friction = au.friction;
          applyMotor(joint, config);
        }
      }
      if (au.motorMaxForce !== undefined) {
        (joint as any).setMotorMaxForce?.(au.motorMaxForce);
      }
    }
  }
}

export function hasConstraint(ctx: PhysicsWorldContext, id: string): boolean {
  return ctx.constraintMap.has(id);
}
