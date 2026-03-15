import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RapierPluginState } from '../types.js';

// --- Mocks ---

vi.mock('@babylonjs/core', () => {
  const PhysicsConstraintType = {
    BALL_AND_SOCKET: 0,
    DISTANCE: 1,
    HINGE: 2,
    SLIDER: 3,
    LOCK: 4,
    PRISMATIC: 5,
    SIX_DOF: 6,
  };
  const PhysicsConstraintAxis = {
    LINEAR_X: 0,
    LINEAR_Y: 1,
    LINEAR_Z: 2,
    ANGULAR_X: 3,
    ANGULAR_Y: 4,
    ANGULAR_Z: 5,
  };
  const PhysicsConstraintMotorType = {
    NONE: 0,
    POSITION: 1,
    VELOCITY: 2,
  };
  const PhysicsConstraintAxisLimitMode = {
    FREE: 0,
    LIMITED: 1,
    LOCKED: 2,
  };
  return {
    PhysicsConstraintType,
    PhysicsConstraintAxis,
    PhysicsConstraintMotorType,
    PhysicsConstraintAxisLimitMode,
  };
});

vi.mock('@rapierphysicsplugin/shared', () => ({
  createJointData: vi.fn(() => ({})),
}));

import {
  PhysicsConstraintType,
  PhysicsConstraintAxis,
  PhysicsConstraintMotorType,
} from '@babylonjs/core';

import {
  setAxisMotorType,
  setAxisMotorTarget,
  setAxisMotorMaxForce,
  getAxisMotorType,
  getAxisMotorTarget,
  getAxisMotorMaxForce,
} from '../constraint-ops.js';

// --- Helpers ---

function makeMockJoint() {
  return {
    setContactsEnabled: vi.fn(),
    setEnabled: vi.fn(),
    setLimits: vi.fn(),
    configureMotorVelocity: vi.fn(),
    configureMotorPosition: vi.fn(),
    setMotorMaxForce: vi.fn(),
    contactsEnabled: vi.fn(() => true),
  };
}

function makeConstraint(type: number) {
  return {
    _type: type,
    _options: {},
  } as any;
}

function makeState(): RapierPluginState {
  return {
    world: {
      createImpulseJoint: vi.fn(),
      removeImpulseJoint: vi.fn(),
    } as any,
    rapier: {} as any,
    bodyToRigidBody: new Map(),
    bodyToColliders: new Map(),
    shapeToColliderDesc: new Map(),
    shapeTypeMap: new Map(),
    shapeMaterialMap: new Map(),
    shapeDensityMap: new Map(),
    shapeFilterMembership: new Map(),
    shapeFilterCollide: new Map(),
    shapeRawData: new Map(),
    bodyCollisionObservables: new Map(),
    bodyCollisionEndedObservables: new Map(),
    constraintToJoint: new Map(),
    constraintBodies: new Map(),
    constraintAxisState: new Map(),
    constraintEnabled: new Map(),
    constraintDescriptors: new Map(),
    collisionCallbackEnabled: new Set(),
    collisionEndedCallbackEnabled: new Set(),
    triggerShapes: new Set(),
    bodyIdToPhysicsBody: new Map(),
    bodyToShape: new Map(),
    shapeToBody: new Map(),
    compoundChildren: new Map(),
    bodyEventMask: new Map(),
    colliderHandleToBody: new Map(),
    bodyToInstanceRigidBodies: new Map(),
    bodyToInstanceColliders: new Map(),
    activeCollisionPairs: new Set(),
    onCollisionObservable: { notifyObservers: vi.fn() } as any,
    onCollisionEndedObservable: { notifyObservers: vi.fn() } as any,
    onTriggerCollisionObservable: { notifyObservers: vi.fn() } as any,
  };
}

// --- Tests ---

describe('constraint-ops motor functions', () => {
  let state: RapierPluginState;
  let joint: ReturnType<typeof makeMockJoint>;

  beforeEach(() => {
    vi.clearAllMocks();
    state = makeState();
    joint = makeMockJoint();
  });

  describe('setAxisMotorType', () => {
    it('stores motorType in axis config', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);

      expect(getAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X)).toBe(PhysicsConstraintMotorType.VELOCITY);
    });

    it('calls applyMotorToJoint with default target 0 for VELOCITY on hinge', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);

      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 100);
    });

    it('calls applyMotorToJoint with default target 0 for POSITION on hinge', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.POSITION);

      expect(joint.configureMotorPosition).toHaveBeenCalledWith(0, 1000, 100);
    });
  });

  describe('setAxisMotorTarget', () => {
    it('stores motorTarget in axis config', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      // Must set motorType first for applyMotorToJoint to fire
      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
      vi.clearAllMocks();

      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 5.0);

      expect(getAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X)).toBe(5.0);
    });

    it('VELOCITY motor on hinge calls configureMotorVelocity(target, 100)', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
      vi.clearAllMocks();

      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 3.14);

      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(3.14, 100);
    });

    it('POSITION motor on hinge calls configureMotorPosition(target, 1000, 100)', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.POSITION);
      vi.clearAllMocks();

      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 1.57);

      expect(joint.configureMotorPosition).toHaveBeenCalledWith(1.57, 1000, 100);
    });
  });

  describe('setAxisMotorMaxForce', () => {
    it('stores motorMaxForce in axis config', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
      setAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 500);

      expect(getAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.ANGULAR_X)).toBe(500);
    });

    it('calls setMotorMaxForce on the joint', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
      vi.clearAllMocks();

      setAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 500);

      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(500);
    });

    it('VELOCITY motor with maxForce calls both configureMotorVelocity and setMotorMaxForce', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 2.0);
      vi.clearAllMocks();

      setAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 750);

      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(2.0, 100);
      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(750);
    });

    it('POSITION motor with maxForce calls both configureMotorPosition and setMotorMaxForce', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.POSITION);
      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 1.0);
      vi.clearAllMocks();

      setAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 750);

      expect(joint.configureMotorPosition).toHaveBeenCalledWith(1.0, 1000, 100);
      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(750);
    });
  });

  describe('slider / prismatic constraints use LINEAR_X axis', () => {
    it('VELOCITY motor on slider uses LINEAR_X', () => {
      const constraint = makeConstraint(PhysicsConstraintType.SLIDER);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.LINEAR_X, PhysicsConstraintMotorType.VELOCITY);
      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.LINEAR_X, 2.5);

      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(2.5, 100);
    });

    it('POSITION motor on prismatic uses LINEAR_X', () => {
      const constraint = makeConstraint(PhysicsConstraintType.PRISMATIC);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.LINEAR_X, PhysicsConstraintMotorType.POSITION);
      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.LINEAR_X, 0.5);

      expect(joint.configureMotorPosition).toHaveBeenCalledWith(0.5, 1000, 100);
    });

    it('slider with maxForce calls setMotorMaxForce', () => {
      const constraint = makeConstraint(PhysicsConstraintType.SLIDER);
      state.constraintToJoint.set(constraint, joint as any);

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.LINEAR_X, PhysicsConstraintMotorType.VELOCITY);
      setAxisMotorMaxForce(state, constraint, PhysicsConstraintAxis.LINEAR_X, 300);

      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(300);
    });
  });

  describe('no-op cases', () => {
    it('does not call motor API when no joint exists', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      // No joint set in state

      setAxisMotorType(state, constraint, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);

      expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
    });

    it('does not call motor API when motorType is not set', () => {
      const constraint = makeConstraint(PhysicsConstraintType.HINGE);
      state.constraintToJoint.set(constraint, joint as any);

      // Set target without setting motorType first
      setAxisMotorTarget(state, constraint, PhysicsConstraintAxis.ANGULAR_X, 5.0);

      expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
      expect(joint.configureMotorPosition).not.toHaveBeenCalled();
    });
  });
});
