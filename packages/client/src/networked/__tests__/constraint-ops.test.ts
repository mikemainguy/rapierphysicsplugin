import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@rapierphysicsplugin/shared', () => ({
  createJointData: vi.fn().mockReturnValue({ fake: 'jointData' }),
}));

vi.mock('../../rapier/constraint-ops.js', () => ({
  buildConstraintDescriptor: vi.fn().mockReturnValue({
    id: '',
    bodyIdA: '',
    bodyIdB: '',
    type: 'HINGE',
    collision: true,
  }),
}));

import {
  applyUpdatesToJoint,
  onAddConstraint,
  onDisposeConstraint,
  sendConstraintUpdate,
  handleConstraintAdded,
  handleConstraintRemoved,
  handleConstraintUpdated,
} from '../constraint-ops.js';
import { createJointData } from '@rapierphysicsplugin/shared';
import { buildConstraintDescriptor } from '../../rapier/constraint-ops.js';

function makeJointMock() {
  return {
    setEnabled: vi.fn(),
    setContactsEnabled: vi.fn(),
    setLimits: vi.fn(),
    configureMotorVelocity: vi.fn(),
    configureMotorPosition: vi.fn(),
    configureMotor: vi.fn(),
    setMotorMaxForce: vi.fn(),
  };
}

function makeState(overrides: Record<string, unknown> = {}): any {
  return {
    bodyToId: new Map(),
    idToBody: new Map(),
    bodyToRigidBody: new Map(),
    constraintToNetId: new Map(),
    constraintToJoint: new Map(),
    localConstraintIds: new Set(),
    remoteConstraintJoints: new Map(),
    rapier: {},
    world: {
      createImpulseJoint: vi.fn().mockReturnValue(makeJointMock()),
      removeImpulseJoint: vi.fn(),
    },
    syncClient: {
      addConstraint: vi.fn(),
      removeConstraint: vi.fn(),
      updateConstraint: vi.fn(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Stub crypto.randomUUID for deterministic IDs
  vi.stubGlobal('crypto', { randomUUID: () => 'abcdefgh-1234-5678-9012-345678901234' });
});

// ---------------------------------------------------------------------------
// applyUpdatesToJoint
// ---------------------------------------------------------------------------
describe('applyUpdatesToJoint', () => {
  it('sets enabled', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, { enabled: false });
    expect(joint.setEnabled).toHaveBeenCalledWith(false);
  });

  it('sets collisions enabled', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, { collisionsEnabled: true });
    expect(joint.setContactsEnabled).toHaveBeenCalledWith(true);
  });

  it('sets limits from axis updates', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, minLimit: -1, maxLimit: 1 }],
    });
    expect(joint.setLimits).toHaveBeenCalledWith(-1, 1);
  });

  it('velocity motor (type=1) calls configureMotorVelocity', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 1, motorTarget: 5, damping: 50 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(5, 50);
  });

  it('position motor (type=2) calls configureMotorPosition', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 2, motorTarget: 3, stiffness: 500, damping: 200 }],
    });
    expect(joint.configureMotorPosition).toHaveBeenCalledWith(3, 500, 200);
  });

  it('NONE motor (type=0) with friction > 0 calls configureMotorVelocity(0, friction)', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 0, friction: 25 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 25);
  });

  it('NONE motor (type=0) with no friction calls configureMotor(0,0,0,0) and setMotorMaxForce(0)', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 0 }],
    });
    expect(joint.configureMotor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(joint.setMotorMaxForce).toHaveBeenCalledWith(0);
  });

  it('uses default values (target=0, stiffness=1000, damping=100) when not specified', () => {
    const joint = makeJointMock();
    // type=2 (position) without explicit target/stiffness/damping
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 2 }],
    });
    expect(joint.configureMotorPosition).toHaveBeenCalledWith(0, 1000, 100);
  });

  it('motorTarget update without existing config is a no-op', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorTarget: 10 }],
    });
    expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
    expect(joint.configureMotorPosition).not.toHaveBeenCalled();
    expect(joint.configureMotor).not.toHaveBeenCalled();
  });

  it('motorTarget update with existing config updates target and re-applies', () => {
    const joint = makeJointMock();
    // First set up a velocity motor config
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 1, motorTarget: 5, damping: 50 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(5, 50);
    joint.configureMotorVelocity.mockClear();

    // Now update just the target
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorTarget: 20 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(20, 50);
  });

  it('friction update with existing config re-applies motor', () => {
    const joint = makeJointMock();
    // Set up a type=0 motor with friction
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 0, friction: 10 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 10);
    joint.configureMotorVelocity.mockClear();

    // Update friction
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, friction: 30 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 30);
  });

  it('friction update without existing config is a no-op', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, friction: 10 }],
    });
    expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
    expect(joint.configureMotorPosition).not.toHaveBeenCalled();
    expect(joint.configureMotor).not.toHaveBeenCalled();
  });

  it('motorMaxForce calls setMotorMaxForce', () => {
    const joint = makeJointMock();
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorMaxForce: 999 }],
    });
    expect(joint.setMotorMaxForce).toHaveBeenCalledWith(999);
  });

  it('NONE motor with friction from previous config calls configureMotorVelocity(0, friction)', () => {
    const joint = makeJointMock();
    // First set up a motor with friction
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 1, motorTarget: 5, damping: 50, friction: 15 }],
    });
    joint.configureMotorVelocity.mockClear();

    // Now switch to type=0 without explicit friction -- should use stored friction
    applyUpdatesToJoint(joint as any, {
      axisUpdates: [{ axis: 0, motorType: 0 }],
    });
    expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 15);
  });
});

// ---------------------------------------------------------------------------
// onAddConstraint
// ---------------------------------------------------------------------------
describe('onAddConstraint', () => {
  it('returns early if bodyA not found in bodyToId', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    // bodyA is not in bodyToId
    state.bodyToId.set(bodyB, 'b-id');

    onAddConstraint(state, bodyA, bodyB, constraint);

    expect(state.constraintToNetId.size).toBe(0);
    expect(state.syncClient.addConstraint).not.toHaveBeenCalled();
  });

  it('returns early if bodyB not found in bodyToId', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    state.bodyToId.set(bodyA, 'a-id');
    // bodyB is not in bodyToId

    onAddConstraint(state, bodyA, bodyB, constraint);

    expect(state.constraintToNetId.size).toBe(0);
    expect(state.syncClient.addConstraint).not.toHaveBeenCalled();
  });

  it('sets constraintToNetId and localConstraintIds', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    state.bodyToId.set(bodyA, 'a-id');
    state.bodyToId.set(bodyB, 'b-id');

    onAddConstraint(state, bodyA, bodyB, constraint);

    const netId = state.constraintToNetId.get(constraint);
    expect(netId).toBeDefined();
    expect(netId).toContain('a-id_b-id_');
    expect(state.localConstraintIds.has(netId)).toBe(true);
  });

  it('after microtasks calls syncClient.addConstraint with correct descriptor', async () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    state.bodyToId.set(bodyA, 'a-id');
    state.bodyToId.set(bodyB, 'b-id');

    vi.mocked(buildConstraintDescriptor).mockReturnValue({
      id: '',
      bodyIdA: '',
      bodyIdB: '',
      type: 'HINGE',
      collision: true,
    } as any);

    onAddConstraint(state, bodyA, bodyB, constraint);

    // Not called yet before microtasks
    expect(state.syncClient.addConstraint).not.toHaveBeenCalled();

    // Flush two levels of queueMicrotask
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(state.syncClient.addConstraint).toHaveBeenCalledTimes(1);
    const descriptor = state.syncClient.addConstraint.mock.calls[0][0];
    expect(descriptor.bodyIdA).toBe('a-id');
    expect(descriptor.bodyIdB).toBe('b-id');
  });

  it('flushes pending updates after creation', async () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    state.bodyToId.set(bodyA, 'a-id');
    state.bodyToId.set(bodyB, 'b-id');

    vi.mocked(buildConstraintDescriptor).mockReturnValue({
      id: '',
      bodyIdA: '',
      bodyIdB: '',
      type: 'HINGE',
      collision: true,
    } as any);

    onAddConstraint(state, bodyA, bodyB, constraint);

    const netId = state.constraintToNetId.get(constraint)!;
    // Queue an update while creation is pending
    sendConstraintUpdate(state, constraint, { enabled: false });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(state.syncClient.addConstraint).toHaveBeenCalledTimes(1);
    expect(state.syncClient.updateConstraint).toHaveBeenCalledWith(netId, { enabled: false });
  });
});

// ---------------------------------------------------------------------------
// onDisposeConstraint
// ---------------------------------------------------------------------------
describe('onDisposeConstraint', () => {
  it('calls syncClient.removeConstraint and cleans up maps', () => {
    const state = makeState();
    const constraint = {} as any;
    state.constraintToNetId.set(constraint, 'c-id');
    state.localConstraintIds.add('c-id');

    onDisposeConstraint(state, constraint);

    expect(state.syncClient.removeConstraint).toHaveBeenCalledWith('c-id');
    expect(state.constraintToNetId.has(constraint)).toBe(false);
    expect(state.localConstraintIds.has('c-id')).toBe(false);
  });

  it('no-op if constraint not tracked', () => {
    const state = makeState();
    const constraint = {} as any;

    onDisposeConstraint(state, constraint);

    expect(state.syncClient.removeConstraint).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendConstraintUpdate
// ---------------------------------------------------------------------------
describe('sendConstraintUpdate', () => {
  it('queues updates when constraint creation is pending', async () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const constraint = {} as any;
    state.bodyToId.set(bodyA, 'a-id');
    state.bodyToId.set(bodyB, 'b-id');

    vi.mocked(buildConstraintDescriptor).mockReturnValue({
      id: '',
      bodyIdA: '',
      bodyIdB: '',
      type: 'HINGE',
      collision: true,
    } as any);

    onAddConstraint(state, bodyA, bodyB, constraint);

    // Before microtask flushes, updates should be queued
    sendConstraintUpdate(state, constraint, { enabled: true });
    sendConstraintUpdate(state, constraint, { collisionsEnabled: false });

    // Not sent directly yet
    expect(state.syncClient.updateConstraint).not.toHaveBeenCalled();

    // After microtasks, the queued updates are flushed
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(state.syncClient.updateConstraint).toHaveBeenCalledTimes(2);
  });

  it('sends directly when not pending', () => {
    const state = makeState();
    const constraint = {} as any;
    state.constraintToNetId.set(constraint, 'c-id');

    sendConstraintUpdate(state, constraint, { enabled: false });

    expect(state.syncClient.updateConstraint).toHaveBeenCalledWith('c-id', { enabled: false });
  });
});

// ---------------------------------------------------------------------------
// handleConstraintAdded
// ---------------------------------------------------------------------------
describe('handleConstraintAdded', () => {
  it('skips if localConstraintIds has the id (own constraint echo)', () => {
    const state = makeState();
    state.localConstraintIds.add('my-id');

    handleConstraintAdded(state, {
      id: 'my-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
    } as any);

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('skips if bodyA not found', () => {
    const state = makeState();
    state.idToBody.set('b', {} as any);

    handleConstraintAdded(state, {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
    } as any);

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('skips if bodyB not found', () => {
    const state = makeState();
    state.idToBody.set('a', {} as any);

    handleConstraintAdded(state, {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
    } as any);

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('skips if rigid body A not found', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    state.idToBody.set('a', bodyA);
    state.idToBody.set('b', bodyB);
    // Only set bodyB's rigid body
    state.bodyToRigidBody.set(bodyB, {} as any);

    handleConstraintAdded(state, {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
    } as any);

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('skips if rigid body B not found', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    state.idToBody.set('a', bodyA);
    state.idToBody.set('b', bodyB);
    // Only set bodyA's rigid body
    state.bodyToRigidBody.set(bodyA, {} as any);

    handleConstraintAdded(state, {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
    } as any);

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('creates joint and stores in remoteConstraintJoints', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const rbA = {} as any;
    const rbB = {} as any;
    state.idToBody.set('a', bodyA);
    state.idToBody.set('b', bodyB);
    state.bodyToRigidBody.set(bodyA, rbA);
    state.bodyToRigidBody.set(bodyB, rbB);

    const descriptor = {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
      collision: true,
    } as any;

    handleConstraintAdded(state, descriptor);

    expect(createJointData).toHaveBeenCalledWith(state.rapier, descriptor);
    expect(state.world.createImpulseJoint).toHaveBeenCalledWith(
      { fake: 'jointData' },
      rbA,
      rbB,
      true,
    );
    expect(state.remoteConstraintJoints.has('c-id')).toBe(true);
  });

  it('disables contacts when collision === false', () => {
    const state = makeState();
    const bodyA = {} as any;
    const bodyB = {} as any;
    const rbA = {} as any;
    const rbB = {} as any;
    state.idToBody.set('a', bodyA);
    state.idToBody.set('b', bodyB);
    state.bodyToRigidBody.set(bodyA, rbA);
    state.bodyToRigidBody.set(bodyB, rbB);

    const joint = makeJointMock();
    state.world.createImpulseJoint.mockReturnValue(joint);

    handleConstraintAdded(state, {
      id: 'c-id',
      bodyIdA: 'a',
      bodyIdB: 'b',
      type: 'HINGE',
      collision: false,
    } as any);

    expect(joint.setContactsEnabled).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// handleConstraintRemoved
// ---------------------------------------------------------------------------
describe('handleConstraintRemoved', () => {
  it('removes remote joint and returns null', () => {
    const state = makeState();
    const joint = makeJointMock();
    state.remoteConstraintJoints.set('c-id', joint as any);

    const result = handleConstraintRemoved(state, 'c-id');

    expect(state.world.removeImpulseJoint).toHaveBeenCalledWith(joint, true);
    expect(state.remoteConstraintJoints.has('c-id')).toBe(false);
    expect(result).toBeNull();
  });

  it('finds and returns local constraint and cleans up maps', () => {
    const state = makeState();
    const constraint = {} as any;
    state.constraintToNetId.set(constraint, 'c-id');
    state.localConstraintIds.add('c-id');

    const result = handleConstraintRemoved(state, 'c-id');

    expect(result).toBe(constraint);
    expect(state.constraintToNetId.has(constraint)).toBe(false);
    expect(state.localConstraintIds.has('c-id')).toBe(false);
  });

  it('returns null when not found', () => {
    const state = makeState();
    const result = handleConstraintRemoved(state, 'nonexistent');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleConstraintUpdated
// ---------------------------------------------------------------------------
describe('handleConstraintUpdated', () => {
  it('applies updates to remote joint', () => {
    const state = makeState();
    const joint = makeJointMock();
    state.remoteConstraintJoints.set('c-id', joint as any);

    handleConstraintUpdated(state, 'c-id', { enabled: false });

    expect(joint.setEnabled).toHaveBeenCalledWith(false);
  });

  it('applies updates to local constraint joint', () => {
    const state = makeState();
    const constraint = {} as any;
    const joint = makeJointMock();
    state.constraintToNetId.set(constraint, 'c-id');
    state.constraintToJoint.set(constraint, joint as any);

    handleConstraintUpdated(state, 'c-id', { collisionsEnabled: true });

    expect(joint.setContactsEnabled).toHaveBeenCalledWith(true);
  });

  it('no-op when constraint not found', () => {
    const state = makeState();

    // Should not throw
    handleConstraintUpdated(state, 'nonexistent', { enabled: true });

    expect(state.world.createImpulseJoint).not.toHaveBeenCalled();
  });

  it('no-op when local constraint has no joint', () => {
    const state = makeState();
    const constraint = {} as any;
    state.constraintToNetId.set(constraint, 'c-id');
    // No joint mapped in constraintToJoint

    // Should not throw
    handleConstraintUpdated(state, 'c-id', { enabled: true });
  });
});
