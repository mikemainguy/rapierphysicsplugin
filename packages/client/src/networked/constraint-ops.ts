import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  PhysicsBody,
  PhysicsConstraint,
} from '@babylonjs/core';
import type {
  ConstraintDescriptor,
  ConstraintUpdates,
} from '@rapierphysicsplugin/shared';
import { createJointData } from '@rapierphysicsplugin/shared';
import { buildConstraintDescriptor } from '../rapier/constraint-ops.js';
import type { NetworkedPluginState } from './types.js';

/** Buffer updates for constraints whose creation hasn't been sent yet. */
const pendingUpdates = new Map<string, ConstraintUpdates[]>();

export function onAddConstraint(
  state: NetworkedPluginState,
  body: PhysicsBody,
  childBody: PhysicsBody,
  constraint: PhysicsConstraint,
): void {
  const bodyIdA = state.bodyToId.get(body);
  const bodyIdB = state.bodyToId.get(childBody);
  if (bodyIdA && bodyIdB) {
    const descriptor = buildConstraintDescriptor(constraint);
    descriptor.id = `${bodyIdA}_${bodyIdB}_${crypto.randomUUID().slice(0, 8)}`;
    descriptor.bodyIdA = bodyIdA;
    descriptor.bodyIdB = bodyIdB;

    state.constraintToNetId.set(constraint, descriptor.id);
    state.localConstraintIds.add(descriptor.id);
    pendingUpdates.set(descriptor.id, []);

    queueMicrotask(() => {
      queueMicrotask(() => {
        state.syncClient.addConstraint(descriptor);
        const queued = pendingUpdates.get(descriptor.id);
        pendingUpdates.delete(descriptor.id);
        if (queued) {
          for (const update of queued) {
            state.syncClient.updateConstraint(descriptor.id, update);
          }
        }
      });
    });
  }
}

export function onDisposeConstraint(
  state: NetworkedPluginState,
  constraint: PhysicsConstraint,
): void {
  const netId = state.constraintToNetId.get(constraint);
  if (netId) {
    state.syncClient.removeConstraint(netId);
    state.constraintToNetId.delete(constraint);
    state.localConstraintIds.delete(netId);
  }
}

export function sendConstraintUpdate(
  state: NetworkedPluginState,
  constraint: PhysicsConstraint,
  updates: ConstraintUpdates,
): void {
  const netId = state.constraintToNetId.get(constraint);
  if (netId) {
    const queue = pendingUpdates.get(netId);
    if (queue) {
      queue.push(updates);
    } else {
      state.syncClient.updateConstraint(netId, updates);
    }
  }
}

export function handleConstraintAdded(state: NetworkedPluginState, descriptor: ConstraintDescriptor): void {
  if (state.localConstraintIds.has(descriptor.id)) return;

  const bodyA = state.idToBody.get(descriptor.bodyIdA);
  const bodyB = state.idToBody.get(descriptor.bodyIdB);
  if (!bodyA || !bodyB) return;

  const rbA = state.bodyToRigidBody.get(bodyA);
  const rbB = state.bodyToRigidBody.get(bodyB);
  if (!rbA || !rbB) return;

  const jointData = createJointData(state.rapier, descriptor);
  const joint = state.world.createImpulseJoint(jointData, rbA, rbB, true);
  if (descriptor.collision === false) {
    joint.setContactsEnabled(false);
  }
  state.remoteConstraintJoints.set(descriptor.id, joint);
}

/**
 * Handle incoming constraint removal.
 * Returns the PhysicsConstraint that needs super.disposeConstraint(),
 * or null if already handled (remote joint or not found).
 */
export function handleConstraintRemoved(
  state: NetworkedPluginState,
  constraintId: string,
): PhysicsConstraint | null {
  const remoteJoint = state.remoteConstraintJoints.get(constraintId);
  if (remoteJoint) {
    state.world.removeImpulseJoint(remoteJoint, true);
    state.remoteConstraintJoints.delete(constraintId);
    return null;
  }

  for (const [constraint, netId] of state.constraintToNetId) {
    if (netId === constraintId) {
      state.constraintToNetId.delete(constraint);
      state.localConstraintIds.delete(constraintId);
      return constraint;
    }
  }
  return null;
}

export function handleConstraintUpdated(
  state: NetworkedPluginState,
  constraintId: string,
  updates: ConstraintUpdates,
): void {
  const remoteJoint = state.remoteConstraintJoints.get(constraintId);
  if (remoteJoint) {
    applyUpdatesToJoint(remoteJoint, updates);
    return;
  }

  for (const [constraint, netId] of state.constraintToNetId) {
    if (netId === constraintId) {
      const joint = state.constraintToJoint.get(constraint);
      if (joint) {
        applyUpdatesToJoint(joint, updates);
      }
      return;
    }
  }
}

/** Tracks per-joint motor config so independent updates can be applied without re-sending motorType. */
interface MotorConfig { type: number; target: number; stiffness: number; damping: number; friction: number }
const clientMotorConfigs = new WeakMap<object, MotorConfig>();

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

export function applyUpdatesToJoint(joint: RAPIER.ImpulseJoint, updates: ConstraintUpdates): void {
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
          friction: au.friction ?? clientMotorConfigs.get(joint)?.friction ?? 0,
        };
        clientMotorConfigs.set(joint, config);
        applyMotor(joint, config);
      } else if (au.motorTarget !== undefined) {
        const config = clientMotorConfigs.get(joint);
        if (config) {
          config.target = au.motorTarget;
          applyMotor(joint, config);
        }
      }
      if (au.friction !== undefined) {
        const config = clientMotorConfigs.get(joint);
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
