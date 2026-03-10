import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RapierPlugin } from '../../rapier/plugin.js';
import { NetworkedRapierPlugin } from '../plugin.js';

// --- Minimal mocks for Rapier WASM types ---

const mockRigidBody = {
  mass: () => 5,
  translation: () => ({ x: 0, y: 0, z: 0 }),
  rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  linvel: () => ({ x: 0, y: 0, z: 0 }),
  angvel: () => ({ x: 0, y: 0, z: 0 }),
  handle: 1,
  setTranslation: () => {},
  setRotation: () => {},
  setLinvel: () => {},
  setAngvel: () => {},
  isFixed: () => false,
  isDynamic: () => true,
  bodyType: () => 0,
};

const mockRigidBody2 = { ...mockRigidBody, handle: 2 };

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

const mockJoint = {
  setContactsEnabled: vi.fn(),
  setEnabled: vi.fn(),
  setLimits: vi.fn(),
  configureMotorVelocity: vi.fn(),
  configureMotorPosition: vi.fn(),
};

const mockWorld = {
  gravity: { x: 0, y: -9.81, z: 0 },
  timestep: 1 / 60,
  createRigidBody() { return mockRigidBody; },
  createCollider() { return {}; },
  createImpulseJoint: vi.fn(() => ({ ...mockJoint })),
  removeImpulseJoint: vi.fn(),
  step() {},
  removeRigidBody() {},
  removeCollider() {},
};

const mockRapier = {
  World: class {
    gravity = mockWorld.gravity;
    timestep = mockWorld.timestep;
    createRigidBody() { return mockRigidBody; }
    createCollider() { return {}; }
    createImpulseJoint = mockWorld.createImpulseJoint;
    removeImpulseJoint = mockWorld.removeImpulseJoint;
    step() {}
    removeRigidBody() {}
    removeCollider() {}
  },
  EventQueue: class {
    drainCollisionEvents() {}
    drainContactForceEvents() {}
  },
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  RigidBodyDesc: {
    dynamic: () => ({ setTranslation: () => ({}), setRotation: () => ({}) }),
    fixed: () => ({ setTranslation: () => ({}), setRotation: () => ({}) }),
    kinematicPositionBased: () => ({ setTranslation: () => ({}), setRotation: () => ({}) }),
  },
  ActiveEvents: { COLLISION_EVENTS: 1 },
  JointData: {
    spherical: () => ({}),
    revolute: () => ({}),
    prismatic: () => ({}),
    fixed: () => ({}),
    generic: () => ({}),
    rope: () => ({}),
    spring: () => ({}),
  },
} as any;

const PhysicsShapeType = { SPHERE: 0, CAPSULE: 1, BOX: 3, MESH: 6 };
const PhysicsMotionType = { STATIC: 0, ANIMATED: 1, DYNAMIC: 2 };

function makeMockBody(name: string) {
  return {
    transformNode: {
      name,
      getScene: () => null,
      metadata: null,
      isDisposed: () => false,
      dispose: () => {},
    },
    _pluginData: {},
    shape: null,
    dispose: () => {},
  } as any;
}

function makeMockShape() {
  return {} as any;
}

function makeMockConstraint() {
  return {
    _type: 0, // BALL_AND_SOCKET
    _options: {},
  } as any;
}

function makeBjsVector3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    clone: () => makeBjsVector3(x, y, z),
  } as any;
}

function makeBjsQuaternion(x = 0, y = 0, z = 0, w = 1) {
  return {
    x, y, z, w,
    clone: () => makeBjsQuaternion(x, y, z, w),
  } as any;
}

describe('NetworkedRapierPlugin constraint lifecycle', () => {
  let plugin: NetworkedRapierPlugin;
  let addConstraintSpy: ReturnType<typeof vi.fn>;
  let removeConstraintSpy: ReturnType<typeof vi.fn>;
  let updateConstraintSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(RapierPlugin.prototype, 'initBody').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'initShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setMassProperties').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'addConstraint').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'disposeConstraint').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setEnabled').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setCollisionsEnabled').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMode').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMinLimit').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMaxLimit').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorType').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorTarget').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorMaxForce').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisFriction').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'removeBody').mockImplementation(() => {});

    mockWorld.createImpulseJoint.mockClear();
    mockWorld.removeImpulseJoint.mockClear();

    plugin = new NetworkedRapierPlugin(
      mockRapier,
      makeBjsVector3(0, -9.81, 0),
      { serverUrl: 'ws://localhost', roomId: 'test-room' },
    );

    addConstraintSpy = vi.fn();
    removeConstraintSpy = vi.fn();
    updateConstraintSpy = vi.fn();
    (plugin as any).syncClient.addConstraint = addConstraintSpy;
    (plugin as any).syncClient.removeConstraint = removeConstraintSpy;
    (plugin as any).syncClient.updateConstraint = updateConstraintSpy;
    (plugin as any).syncClient.addBody = vi.fn();
    (plugin as any).syncClient.removeBody = vi.fn();
    vi.spyOn(plugin as any, 'sendMeshBinaryForBody').mockImplementation(() => {});
  });

  function registerBody(name: string, rb = mockRigidBody) {
    const body = makeMockBody(name);
    const shape = makeMockShape();
    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shape, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(body, rb as any);
    plugin.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });
    plugin.setShape(body, shape);
    return body;
  }

  it('addConstraint() sends ADD_CONSTRAINT to server with correct descriptor', async () => {
    const bodyA = registerBody('bodyA');
    const bodyB = registerBody('bodyB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    // Flush double-deferred microtasks
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

    expect(addConstraintSpy).toHaveBeenCalledOnce();
    const desc = addConstraintSpy.mock.calls[0][0];
    expect(desc.bodyIdA).toBe('bodyA');
    expect(desc.bodyIdB).toBe('bodyB');
    expect(desc.id).toContain('bodyA_bodyB_');
  });

  it('addConstraint() stores constraint ID mapping', async () => {
    const bodyA = registerBody('mapA');
    const bodyB = registerBody('mapB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    const netId = (plugin as any).constraintToNetId.get(constraint);
    expect(netId).toBeDefined();
    expect((plugin as any).localConstraintIds.has(netId)).toBe(true);
  });

  it('disposeConstraint() sends REMOVE_CONSTRAINT to server', async () => {
    const bodyA = registerBody('dispA');
    const bodyB = registerBody('dispB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    const netId = (plugin as any).constraintToNetId.get(constraint);

    plugin.disposeConstraint(constraint);

    expect(removeConstraintSpy).toHaveBeenCalledWith(netId);
    expect((plugin as any).constraintToNetId.has(constraint)).toBe(false);
    expect((plugin as any).localConstraintIds.has(netId)).toBe(false);
  });

  it('incoming ADD_CONSTRAINT creates remote Rapier joint', async () => {
    const bodyA = registerBody('remoteA');
    const bodyB = registerBody('remoteB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const descriptor = {
      id: 'remote_constraint_1',
      bodyIdA: 'remoteA',
      bodyIdB: 'remoteB',
      type: 'ball_and_socket' as const,
      collision: false,
    };

    (plugin as any).handleConstraintAdded(descriptor);

    expect((plugin as any).remoteConstraintJoints.has('remote_constraint_1')).toBe(true);
  });

  it('incoming ADD_CONSTRAINT for own constraint is skipped (no duplicate)', async () => {
    const bodyA = registerBody('ownA');
    const bodyB = registerBody('ownB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    const netId = (plugin as any).constraintToNetId.get(constraint);

    // Simulate the echo-back from the server
    const descriptor = {
      id: netId,
      bodyIdA: 'ownA',
      bodyIdB: 'ownB',
      type: 'ball_and_socket' as const,
    };

    (plugin as any).handleConstraintAdded(descriptor);

    // Should NOT have created a remote joint for our own constraint
    expect((plugin as any).remoteConstraintJoints.has(netId)).toBe(false);
  });

  it('incoming REMOVE_CONSTRAINT disposes remote joint', async () => {
    const bodyA = registerBody('rmRemA');
    const bodyB = registerBody('rmRemB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const descriptor = {
      id: 'remote_to_remove',
      bodyIdA: 'rmRemA',
      bodyIdB: 'rmRemB',
      type: 'ball_and_socket' as const,
    };

    (plugin as any).handleConstraintAdded(descriptor);
    expect((plugin as any).remoteConstraintJoints.has('remote_to_remove')).toBe(true);

    (plugin as any).handleConstraintRemoved('remote_to_remove');
    expect((plugin as any).remoteConstraintJoints.has('remote_to_remove')).toBe(false);
  });

  it('incoming REMOVE_CONSTRAINT for local constraint disposes it', async () => {
    const bodyA = registerBody('rmLocA');
    const bodyB = registerBody('rmLocB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    const netId = (plugin as any).constraintToNetId.get(constraint);
    const disposeConstraintSpy = vi.spyOn(RapierPlugin.prototype, 'disposeConstraint');

    (plugin as any).handleConstraintRemoved(netId);

    expect(disposeConstraintSpy).toHaveBeenCalledWith(constraint);
    expect((plugin as any).constraintToNetId.has(constraint)).toBe(false);
    expect((plugin as any).localConstraintIds.has(netId)).toBe(false);
  });

  it('setEnabled() sends UPDATE_CONSTRAINT', async () => {
    const bodyA = registerBody('enA');
    const bodyB = registerBody('enB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    const netId = (plugin as any).constraintToNetId.get(constraint);

    plugin.setEnabled(constraint, false);

    expect(updateConstraintSpy).toHaveBeenCalledWith(netId, { enabled: false });
  });

  it('simulation reset clears constraint tracking', async () => {
    const bodyA = registerBody('resetA');
    const bodyB = registerBody('resetB', mockRigidBody2 as any);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // Add a local constraint
    const constraint = makeMockConstraint();
    plugin.addConstraint(bodyA, bodyB, constraint);

    // Add a remote constraint
    const descriptor = {
      id: 'remote_reset_test',
      bodyIdA: 'resetA',
      bodyIdB: 'resetB',
      type: 'ball_and_socket' as const,
    };
    (plugin as any).handleConstraintAdded(descriptor);

    expect((plugin as any).constraintToNetId.size).toBeGreaterThan(0);
    expect((plugin as any).localConstraintIds.size).toBeGreaterThan(0);
    expect((plugin as any).remoteConstraintJoints.size).toBeGreaterThan(0);

    // Trigger simulation reset
    (plugin as any).handleSimulationStarted({
      tick: 0,
      timestamp: Date.now(),
      bodies: [],
    });

    expect((plugin as any).constraintToNetId.size).toBe(0);
    expect((plugin as any).localConstraintIds.size).toBe(0);
    expect((plugin as any).remoteConstraintJoints.size).toBe(0);
  });
});
