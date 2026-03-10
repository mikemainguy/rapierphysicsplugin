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
import { buildConstraintDescriptor } from './rapier-constraint-ops.js';
import type { NetworkedPluginState } from './networked-plugin-types.js';

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

    queueMicrotask(() => {
      queueMicrotask(() => {
        state.syncClient.addConstraint(descriptor);
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
    state.syncClient.updateConstraint(netId, updates);
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
      if (au.motorTarget !== undefined) {
        const maxForce = au.motorMaxForce ?? 1000;
        if (au.motorType === 1) {
          (joint as any).configureMotorVelocity?.(au.motorTarget, maxForce);
        } else {
          (joint as any).configureMotorPosition?.(au.motorTarget, maxForce, 0);
        }
      }
    }
  }
}
