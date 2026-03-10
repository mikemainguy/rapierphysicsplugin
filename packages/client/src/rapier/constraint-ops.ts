import type RAPIER from '@dimforge/rapier3d-compat';
import {
  PhysicsConstraintType,
  PhysicsConstraintAxis,
  PhysicsConstraintMotorType,
} from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsConstraint,
  PhysicsConstraintAxisLimitMode,
  ConstrainedBodyPair,
  Nullable,
} from '@babylonjs/core';
import type { ConstraintDescriptor } from '@rapierphysicsplugin/shared';
import { createJointData } from '@rapierphysicsplugin/shared';
import type { RapierPluginState, AxisConfig } from './types.js';
import { v3toVec } from './types.js';

export function buildConstraintDescriptor(constraint: PhysicsConstraint): ConstraintDescriptor {
  const opts = (constraint as any)._options ?? {};
  const cType = (constraint as any)._type as PhysicsConstraintType;

  let type: ConstraintDescriptor['type'];
  switch (cType) {
    case PhysicsConstraintType.BALL_AND_SOCKET: type = 'ball_and_socket'; break;
    case PhysicsConstraintType.DISTANCE: type = 'distance'; break;
    case PhysicsConstraintType.HINGE: type = 'hinge'; break;
    case PhysicsConstraintType.SLIDER: type = 'slider'; break;
    case PhysicsConstraintType.LOCK: type = 'lock'; break;
    case PhysicsConstraintType.PRISMATIC: type = 'prismatic'; break;
    case PhysicsConstraintType.SIX_DOF: type = 'six_dof'; break;
    default: type = 'ball_and_socket';
  }

  const sixDofLimits = (constraint as any).limits as Array<{ axis: number; minLimit?: number; maxLimit?: number; stiffness?: number; damping?: number }> | undefined;
  let isSpring = false;
  if (type === 'six_dof' && sixDofLimits) {
    isSpring = sixDofLimits.some(l => l.stiffness !== undefined && l.stiffness > 0);
  }

  const desc: ConstraintDescriptor = {
    id: '',
    bodyIdA: '',
    bodyIdB: '',
    type: isSpring ? 'spring' : type,
    pivotA: opts.pivotA ? v3toVec(opts.pivotA) : undefined,
    pivotB: opts.pivotB ? v3toVec(opts.pivotB) : undefined,
    axisA: opts.axisA ? v3toVec(opts.axisA) : undefined,
    axisB: opts.axisB ? v3toVec(opts.axisB) : undefined,
    perpAxisA: opts.perpAxisA ? v3toVec(opts.perpAxisA) : undefined,
    perpAxisB: opts.perpAxisB ? v3toVec(opts.perpAxisB) : undefined,
    maxDistance: opts.maxDistance,
    collision: opts.collision,
  };

  if (isSpring && sixDofLimits) {
    const springLimit = sixDofLimits.find(l => l.stiffness !== undefined);
    if (springLimit) {
      desc.stiffness = springLimit.stiffness;
      desc.damping = springLimit.damping;
    }
  }

  if (type === 'six_dof' && !isSpring && sixDofLimits) {
    desc.limits = sixDofLimits.map(l => ({
      axis: l.axis,
      minLimit: l.minLimit,
      maxLimit: l.maxLimit,
    }));
  }

  return desc;
}

export function createJointFromConstraint(
  state: RapierPluginState,
  constraint: PhysicsConstraint,
  rbA: RAPIER.RigidBody,
  rbB: RAPIER.RigidBody,
): RAPIER.ImpulseJoint {
  const desc = buildConstraintDescriptor(constraint);
  const jointData = createJointData(state.rapier, desc);
  return state.world.createImpulseJoint(jointData, rbA, rbB, true);
}

export function initConstraint(
  state: RapierPluginState,
  constraint: PhysicsConstraint,
  body: PhysicsBody,
  childBody: PhysicsBody,
): void {
  if (state.constraintToJoint.has(constraint)) return;

  const rbA = state.bodyToRigidBody.get(body);
  const rbB = state.bodyToRigidBody.get(childBody);
  if (!rbA || !rbB) return;

  const joint = createJointFromConstraint(state, constraint, rbA, rbB);
  state.constraintToJoint.set(constraint, joint);
  state.constraintBodies.set(constraint, { body, childBody });
  state.constraintEnabled.set(constraint, true);

  const opts = (constraint as any)._options;
  if (opts?.collision === false) {
    joint.setContactsEnabled(false);
  }

  applyInitialLimits(constraint, joint);
}

function applyInitialLimits(constraint: PhysicsConstraint, joint: RAPIER.ImpulseJoint): void {
  const sixDofLimits = (constraint as any).limits as Array<{ axis: number; minLimit?: number; maxLimit?: number }> | undefined;
  if (!sixDofLimits) return;

  const cType = (constraint as any)._type as PhysicsConstraintType;
  if (cType === PhysicsConstraintType.HINGE) {
    const angLim = sixDofLimits.find(l => l.axis === PhysicsConstraintAxis.ANGULAR_X);
    if (angLim && angLim.minLimit !== undefined && angLim.maxLimit !== undefined) {
      (joint as any).setLimits?.(angLim.minLimit, angLim.maxLimit);
    }
  } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
    const linLim = sixDofLimits.find(l => l.axis === PhysicsConstraintAxis.LINEAR_X);
    if (linLim && linLim.minLimit !== undefined && linLim.maxLimit !== undefined) {
      (joint as any).setLimits?.(linLim.minLimit, linLim.maxLimit);
    }
  }
}

export function disposeConstraint(state: RapierPluginState, constraint: PhysicsConstraint): void {
  const joint = state.constraintToJoint.get(constraint);
  if (joint) {
    state.world.removeImpulseJoint(joint, true);
    state.constraintToJoint.delete(constraint);
  }
  state.constraintBodies.delete(constraint);
  state.constraintAxisState.delete(constraint);
  state.constraintEnabled.delete(constraint);
  state.constraintDescriptors.delete(constraint);
}

export function setEnabled(state: RapierPluginState, constraint: PhysicsConstraint, isEnabled: boolean): void {
  const currentlyEnabled = state.constraintEnabled.get(constraint) ?? true;
  if (isEnabled === currentlyEnabled) return;

  if (!isEnabled) {
    const joint = state.constraintToJoint.get(constraint);
    if (joint) {
      state.world.removeImpulseJoint(joint, true);
      state.constraintToJoint.delete(constraint);
    }
    state.constraintEnabled.set(constraint, false);
  } else {
    const pair = state.constraintBodies.get(constraint);
    if (pair) {
      const rbA = state.bodyToRigidBody.get(pair.body);
      const rbB = state.bodyToRigidBody.get(pair.childBody);
      if (rbA && rbB) {
        const joint = createJointFromConstraint(state, constraint, rbA, rbB);
        state.constraintToJoint.set(constraint, joint);

        const opts = (constraint as any)._options;
        if (opts?.collision === false) {
          joint.setContactsEnabled(false);
        }
      }
    }
    state.constraintEnabled.set(constraint, true);
  }
}

export function getEnabled(state: RapierPluginState, constraint: PhysicsConstraint): boolean {
  return state.constraintEnabled.get(constraint) ?? true;
}

export function setCollisionsEnabled(state: RapierPluginState, constraint: PhysicsConstraint, isEnabled: boolean): void {
  const joint = state.constraintToJoint.get(constraint);
  if (joint) {
    joint.setContactsEnabled(isEnabled);
  }
}

export function getCollisionsEnabled(state: RapierPluginState, constraint: PhysicsConstraint): boolean {
  const joint = state.constraintToJoint.get(constraint);
  if (joint) {
    return joint.contactsEnabled();
  }
  return true;
}

function ensureAxisConfig(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): AxisConfig {
  let axisMap = state.constraintAxisState.get(constraint);
  if (!axisMap) {
    axisMap = new Map();
    state.constraintAxisState.set(constraint, axisMap);
  }
  let config = axisMap.get(axis);
  if (!config) {
    config = {};
    axisMap.set(axis, config);
  }
  return config;
}

function getAxisConfig(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): AxisConfig | undefined {
  return state.constraintAxisState.get(constraint)?.get(axis);
}

export function setAxisFriction(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, friction: number): void {
  ensureAxisConfig(state, constraint, axis).friction = friction;
}

export function getAxisFriction(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
  return getAxisConfig(state, constraint, axis)?.friction ?? null;
}

export function setAxisMode(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limitMode: PhysicsConstraintAxisLimitMode): void {
  ensureAxisConfig(state, constraint, axis).mode = limitMode;
  applyAxisLimitsToJoint(state, constraint);
}

export function getAxisMode(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintAxisLimitMode> {
  return getAxisConfig(state, constraint, axis)?.mode ?? null;
}

export function setAxisMinLimit(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, minLimit: number): void {
  ensureAxisConfig(state, constraint, axis).minLimit = minLimit;
  applyAxisLimitsToJoint(state, constraint);
}

export function getAxisMinLimit(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
  return getAxisConfig(state, constraint, axis)?.minLimit ?? null;
}

export function setAxisMaxLimit(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limit: number): void {
  ensureAxisConfig(state, constraint, axis).maxLimit = limit;
  applyAxisLimitsToJoint(state, constraint);
}

export function getAxisMaxLimit(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
  return getAxisConfig(state, constraint, axis)?.maxLimit ?? null;
}

function applyAxisLimitsToJoint(state: RapierPluginState, constraint: PhysicsConstraint): void {
  const joint = state.constraintToJoint.get(constraint);
  if (!joint) return;

  const cType = (constraint as any)._type as PhysicsConstraintType;

  if (cType === PhysicsConstraintType.HINGE) {
    const angConfig = getAxisConfig(state, constraint, PhysicsConstraintAxis.ANGULAR_X);
    if (angConfig?.minLimit !== undefined && angConfig?.maxLimit !== undefined) {
      (joint as any).setLimits?.(angConfig.minLimit, angConfig.maxLimit);
    }
  } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
    const linConfig = getAxisConfig(state, constraint, PhysicsConstraintAxis.LINEAR_X);
    if (linConfig?.minLimit !== undefined && linConfig?.maxLimit !== undefined) {
      (joint as any).setLimits?.(linConfig.minLimit, linConfig.maxLimit);
    }
  }
}

export function setAxisMotorType(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, motorType: PhysicsConstraintMotorType): void {
  ensureAxisConfig(state, constraint, axis).motorType = motorType;
  applyMotorToJoint(state, constraint);
}

export function getAxisMotorType(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<PhysicsConstraintMotorType> {
  return getAxisConfig(state, constraint, axis)?.motorType ?? null;
}

export function setAxisMotorTarget(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, target: number): void {
  ensureAxisConfig(state, constraint, axis).motorTarget = target;
  applyMotorToJoint(state, constraint);
}

export function getAxisMotorTarget(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
  return getAxisConfig(state, constraint, axis)?.motorTarget ?? null;
}

export function setAxisMotorMaxForce(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, maxForce: number): void {
  ensureAxisConfig(state, constraint, axis).motorMaxForce = maxForce;
  applyMotorToJoint(state, constraint);
}

export function getAxisMotorMaxForce(state: RapierPluginState, constraint: PhysicsConstraint, axis: PhysicsConstraintAxis): Nullable<number> {
  return getAxisConfig(state, constraint, axis)?.motorMaxForce ?? null;
}

function applyMotorToJoint(state: RapierPluginState, constraint: PhysicsConstraint): void {
  const joint = state.constraintToJoint.get(constraint);
  if (!joint) return;

  const cType = (constraint as any)._type as PhysicsConstraintType;

  if (cType === PhysicsConstraintType.HINGE) {
    const config = getAxisConfig(state, constraint, PhysicsConstraintAxis.ANGULAR_X);
    if (config?.motorTarget !== undefined) {
      const maxForce = config.motorMaxForce ?? 1000;
      if (config.motorType === PhysicsConstraintMotorType.VELOCITY) {
        (joint as any).configureMotorVelocity?.(config.motorTarget, maxForce);
      } else {
        (joint as any).configureMotorPosition?.(config.motorTarget, maxForce, 0);
      }
    }
  } else if (cType === PhysicsConstraintType.SLIDER || cType === PhysicsConstraintType.PRISMATIC) {
    const config = getAxisConfig(state, constraint, PhysicsConstraintAxis.LINEAR_X);
    if (config?.motorTarget !== undefined) {
      const maxForce = config.motorMaxForce ?? 1000;
      if (config.motorType === PhysicsConstraintMotorType.VELOCITY) {
        (joint as any).configureMotorVelocity?.(config.motorTarget, maxForce);
      } else {
        (joint as any).configureMotorPosition?.(config.motorTarget, maxForce, 0);
      }
    }
  }
}

export function getBodiesUsingConstraint(state: RapierPluginState, constraint: PhysicsConstraint): ConstrainedBodyPair[] {
  const pair = state.constraintBodies.get(constraint);
  if (!pair) return [];
  return [{
    parentBody: pair.body,
    parentBodyIndex: 0,
    childBody: pair.childBody,
    childBodyIndex: 0,
  }];
}
