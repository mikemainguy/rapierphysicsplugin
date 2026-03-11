import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RapierPlugin } from '../../rapier/plugin.js';
import { NetworkedRapierPlugin } from '../plugin.js';

// --- Minimal mocks ---

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  clone() { return new MockVector3(this.x, this.y, this.z); }
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  clone() { return new MockQuaternion(this.x, this.y, this.z, this.w); }
}

const PhysicsShapeType = { SPHERE: 0, BOX: 3 };
const PhysicsMotionType = { DYNAMIC: 2 };

const mockRapier = {
  World: class {
    gravity = { x: 0, y: -9.81, z: 0 };
    timestep = 1 / 60;
    createRigidBody() { return mockRigidBody; }
    createCollider() { return {}; }
    createImpulseJoint = vi.fn(() => ({}));
    removeImpulseJoint = vi.fn();
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

function makeConfig(overrides = {}) {
  return {
    serverUrl: 'ws://localhost:3000',
    roomId: 'test-room',
    ...overrides,
  };
}

function makeMockBody(name: string) {
  return {
    transformNode: {
      name,
      getScene: () => null,
      metadata: null,
      isDisposed: () => false,
      dispose: () => {},
      position: { set: vi.fn() },
      rotationQuaternion: { set: vi.fn() },
    },
    _pluginData: {},
    shape: null,
    dispose: () => {},
  } as any;
}

// --- Tests ---

describe('NetworkedRapierPlugin', () => {
  let plugin: NetworkedRapierPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub super methods that touch Rapier internals
    vi.spyOn(RapierPlugin.prototype, 'initBody').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'initShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setMassProperties').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'addConstraint').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'disposeConstraint').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'removeBody').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'sync').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setEnabled').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setCollisionsEnabled').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMode').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMinLimit').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMaxLimit').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorType').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorTarget').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisMotorMaxForce').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setAxisFriction').mockImplementation(() => {});

    plugin = new NetworkedRapierPlugin(
      mockRapier,
      new MockVector3(0, -9.81, 0) as any,
      makeConfig(),
    );

    // Stub syncClient methods
    (plugin as any).syncClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      joinRoom: vi.fn().mockResolvedValue({ tick: 0, timestamp: 0, bodies: [] }),
      onBodyAdded: vi.fn(),
      onBodyRemoved: vi.fn(),
      onMeshBinary: vi.fn(),
      onGeometryDef: vi.fn(),
      onMeshRef: vi.fn(),
      onMaterialDef: vi.fn(),
      onTextureDef: vi.fn(),
      onSimulationStarted: vi.fn(),
      onCollisionEvents: vi.fn(),
      onConstraintAdded: vi.fn(),
      onConstraintRemoved: vi.fn(),
      onConstraintUpdated: vi.fn(),
      onStateUpdate: vi.fn(),
      startSimulation: vi.fn(),
      sendInput: vi.fn(),
      addBody: vi.fn(),
      removeBody: vi.fn(),
      addConstraint: vi.fn(),
      removeConstraint: vi.fn(),
      updateConstraint: vi.fn(),
      getClientId: vi.fn(() => 'client-1'),
      getClockSync: vi.fn(() => ({})),
      getReconciler: vi.fn(() => ({})),
      shapeCastQuery: vi.fn().mockResolvedValue({ hit: true, hitBodyId: 'body1', fraction: 1.5 }),
      shapeProximityQuery: vi.fn().mockResolvedValue({ hit: true, hitBodyId: 'body2', distance: 0.5 }),
      pointProximityQuery: vi.fn().mockResolvedValue({ hit: false, hitBodyId: null, distance: 10 }),
      get simulationRunning() { return true; },
      get totalBodyCount() { return 42; },
      get bytesSent() { return 100; },
      get bytesReceived() { return 200; },
    };
  });

  describe('constructor', () => {
    it('stores config and creates syncClient', () => {
      const p = new NetworkedRapierPlugin(
        mockRapier,
        new MockVector3(0, -9.81, 0) as any,
        makeConfig({ renderDelayMs: 100 }),
      );
      expect(p.config.serverUrl).toBe('ws://localhost:3000');
      expect(p.config.roomId).toBe('test-room');
      expect(p.config.renderDelayMs).toBe(100);
      expect(p.syncClient).toBeDefined();
    });
  });

  describe('connect', () => {
    it('connects to server and joins room', async () => {
      const snapshot = await plugin.connect();

      expect(plugin.syncClient.connect).toHaveBeenCalledWith('ws://localhost:3000');
      expect(plugin.syncClient.joinRoom).toHaveBeenCalledWith('test-room');
      expect(snapshot).toEqual({ tick: 0, timestamp: 0, bodies: [] });
    });

    it('sets scene if provided', async () => {
      const scene = { name: 'test-scene' } as any;
      await plugin.connect(scene);
      expect(plugin.scene).toBe(scene);
    });

    it('registers all callback handlers', async () => {
      await plugin.connect();

      expect(plugin.syncClient.onBodyAdded).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onBodyRemoved).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onMeshBinary).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onGeometryDef).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onMeshRef).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onMaterialDef).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onTextureDef).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onSimulationStarted).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onCollisionEvents).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onConstraintAdded).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onConstraintRemoved).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onConstraintUpdated).toHaveBeenCalledOnce();
      expect(plugin.syncClient.onStateUpdate).toHaveBeenCalledOnce();
    });

    it('collision events callback increments collisionCount', async () => {
      // Stub injectCollisionEvents since it depends on Rapier internals
      vi.spyOn(plugin as any, 'injectCollisionEvents').mockImplementation(() => {});
      await plugin.connect();

      const collisionCb = (plugin.syncClient.onCollisionEvents as any).mock.calls[0][0];
      collisionCb([{ type: 'COLLISION_STARTED' }, { type: 'COLLISION_STARTED' }]);

      expect(plugin.collisionCount).toBe(2);
      expect(plugin.collisionEventCount).toBe(2);
    });

    it('stateUpdate callback notifies registered listeners', async () => {
      await plugin.connect();

      const listener = vi.fn();
      plugin.onStateUpdate(listener);

      const stateUpdateCb = (plugin.syncClient.onStateUpdate as any).mock.calls[0][0];
      const snapshot = { tick: 1, timestamp: 100, bodies: [] };
      stateUpdateCb(snapshot);

      expect(listener).toHaveBeenCalledWith(snapshot);
    });
  });

  describe('body lifecycle overrides', () => {
    it('initBody calls super and delegates to bodyOps', () => {
      const body = makeMockBody('test');
      const pos = new MockVector3(1, 2, 3) as any;
      const rot = new MockQuaternion() as any;

      plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, pos, rot);

      expect(RapierPlugin.prototype.initBody).toHaveBeenCalledWith(
        body, PhysicsMotionType.DYNAMIC, pos, rot,
      );
      // Body is registered as pending
      expect(plugin.pendingBodies.has(body)).toBe(true);
    });

    it('initShape calls super and caches shape params', () => {
      const shape = {} as any;
      plugin.initShape(shape, PhysicsShapeType.BOX as any, { extents: new MockVector3(1, 1, 1) } as any);

      expect(RapierPlugin.prototype.initShape).toHaveBeenCalled();
      expect(plugin.shapeParamsCache.has(shape)).toBe(true);
    });

    it('setShape calls super and delegates to bodyOps', () => {
      const body = makeMockBody('shapeTest');
      const shape = {} as any;

      plugin.setShape(body, shape);

      expect(RapierPlugin.prototype.setShape).toHaveBeenCalledWith(body, shape);
    });

    it('setMassProperties calls super and stores mass override', () => {
      const body = makeMockBody('massTest');
      const massProps = { mass: 10 } as any;

      plugin.setMassProperties(body, massProps);

      expect(RapierPlugin.prototype.setMassProperties).toHaveBeenCalledWith(body, massProps, undefined);
      expect(plugin.bodyMassOverride.get(body)).toBe(10);
    });

    it('removeBody calls bodyOps then super', () => {
      const body = makeMockBody('removeTest');
      const bodyId = 'removeTest';
      plugin.bodyToId.set(body, bodyId);
      plugin.idToBody.set(bodyId, body);
      plugin.bodyIdToPhysicsBody.set(bodyId, body);

      plugin.removeBody(body);

      expect(plugin.syncClient.removeBody).toHaveBeenCalledWith(bodyId);
      expect(RapierPlugin.prototype.removeBody).toHaveBeenCalledWith(body);
      expect(plugin.bodyToId.has(body)).toBe(false);
    });

    it('sync returns early for networked bodies', () => {
      const body = makeMockBody('syncTest');
      plugin.bodyToId.set(body, 'syncTest');

      plugin.sync(body);

      // super.sync should NOT be called for networked bodies
      expect(RapierPlugin.prototype.sync).not.toHaveBeenCalled();
    });

    it('sync falls through to super for non-networked bodies', () => {
      const body = makeMockBody('localBody');

      plugin.sync(body);

      expect(RapierPlugin.prototype.sync).toHaveBeenCalledWith(body);
    });
  });

  describe('handleSimulationStarted', () => {
    it('removes all tracked bodies via super.removeBody', () => {
      const body1 = makeMockBody('sim1');
      const body2 = makeMockBody('sim2');
      plugin.bodyToId.set(body1, 'sim1');
      plugin.bodyToId.set(body2, 'sim2');
      // Also need them in bodyToId entries returned by handleSimulationStarted
      const tn1 = { dispose: vi.fn() };
      const tn2 = { dispose: vi.fn() };
      const fakeBody1 = { transformNode: tn1 } as any;
      const fakeBody2 = { transformNode: tn2 } as any;
      (plugin as any).bodyToId = new Map([[fakeBody1, 'sim1'], [fakeBody2, 'sim2']]);

      const snapshot = { tick: 0, timestamp: 0, bodies: [] };
      (plugin as any).handleSimulationStarted(snapshot);

      expect(RapierPlugin.prototype.removeBody).toHaveBeenCalledTimes(2);
    });

    it('fires simulation reset callbacks', () => {
      const cb = vi.fn();
      plugin.onSimulationReset(cb);

      (plugin as any).handleSimulationStarted({ tick: 0, timestamp: 0, bodies: [] });

      expect(cb).toHaveBeenCalledOnce();
    });
  });

  describe('handleConstraintRemoved', () => {
    it('calls super.disposeConstraint when constraint found', () => {
      const constraint = { _type: 0, _options: {} } as any;
      const netId = 'test-constraint-id';
      plugin.constraintToNetId.set(constraint, netId);
      plugin.localConstraintIds.add(netId);

      (plugin as any).handleConstraintRemoved(netId);

      expect(RapierPlugin.prototype.disposeConstraint).toHaveBeenCalledWith(constraint);
    });

    it('does not call super.disposeConstraint when constraint not found', () => {
      (plugin as any).handleConstraintRemoved('nonexistent');

      expect(RapierPlugin.prototype.disposeConstraint).not.toHaveBeenCalled();
    });
  });

  describe('physics API overrides', () => {
    it('applyForce sends input to server', () => {
      const body = makeMockBody('forceBody');
      plugin.bodyToId.set(body, 'forceBody');

      plugin.applyForce(body, new MockVector3(1, 0, 0) as any, new MockVector3(0, 0, 0) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });

    it('applyImpulse sends input to server', () => {
      const body = makeMockBody('impulseBody');
      plugin.bodyToId.set(body, 'impulseBody');

      plugin.applyImpulse(body, new MockVector3(0, 5, 0) as any, new MockVector3(0, 0, 0) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });

    it('setLinearVelocity sends input to server', () => {
      const body = makeMockBody('velBody');
      plugin.bodyToId.set(body, 'velBody');

      plugin.setLinearVelocity(body, new MockVector3(1, 2, 3) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });

    it('setTargetTransform sends input to server', () => {
      const body = makeMockBody('transformBody');
      plugin.bodyToId.set(body, 'transformBody');

      plugin.setTargetTransform(
        body,
        new MockVector3(1, 2, 3) as any,
        new MockQuaternion(0, 0, 0, 1) as any,
      );

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });
  });

  describe('proxy methods', () => {
    it('startSimulation delegates to syncClient', () => {
      plugin.startSimulation();
      expect(plugin.syncClient.startSimulation).toHaveBeenCalledOnce();
    });

    it('sendInput delegates to syncClient', () => {
      const actions = [{ type: 'jump' }] as any;
      plugin.sendInput(actions);
      expect(plugin.syncClient.sendInput).toHaveBeenCalledWith(actions);
    });

    it('onCollisionEvents delegates to syncClient', () => {
      const cb = vi.fn();
      plugin.onCollisionEvents(cb);
      expect(plugin.syncClient.onCollisionEvents).toHaveBeenCalledWith(cb);
    });

    it('onSimulationReset stores callback', () => {
      const cb = vi.fn();
      plugin.onSimulationReset(cb);
      expect(plugin.simulationResetCallbacks).toContain(cb);
    });

    it('onStateUpdate stores callback', () => {
      const cb = vi.fn();
      plugin.onStateUpdate(cb);
      expect(plugin.stateUpdateCallbacks).toContain(cb);
    });

    it('getSyncClient returns the sync client', () => {
      expect(plugin.getSyncClient()).toBe(plugin.syncClient);
    });

    it('getClientId delegates to syncClient', () => {
      expect(plugin.getClientId()).toBe('client-1');
    });

    it('getReconciler delegates to syncClient', () => {
      plugin.getReconciler();
      expect(plugin.syncClient.getReconciler).toHaveBeenCalled();
    });

    it('getClockSync delegates to syncClient', () => {
      plugin.getClockSync();
      expect(plugin.syncClient.getClockSync).toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('simulationRunning reflects syncClient', () => {
      expect(plugin.simulationRunning).toBe(true);
    });

    it('totalBodyCount reflects syncClient', () => {
      expect(plugin.totalBodyCount).toBe(42);
    });

    it('bytesSent reflects syncClient', () => {
      expect(plugin.bytesSent).toBe(100);
    });

    it('bytesReceived reflects syncClient', () => {
      expect(plugin.bytesReceived).toBe(200);
    });

    it('collisionEventCount reflects collisionCount', () => {
      plugin.collisionCount = 7;
      expect(plugin.collisionEventCount).toBe(7);
    });
  });

  describe('createAsync', () => {
    it('creates plugin, enables physics, connects, and returns snapshot', async () => {
      const scene = { enablePhysics: vi.fn() } as any;
      const config = makeConfig();

      // Mock connect on the prototype to avoid real WS
      const mockSnapshot = { tick: 1, timestamp: 100, bodies: [] };
      vi.spyOn(NetworkedRapierPlugin.prototype, 'connect').mockResolvedValue(mockSnapshot as any);

      const result = await NetworkedRapierPlugin.createAsync(
        mockRapier,
        new MockVector3(0, -9.81, 0) as any,
        config,
        scene,
      );

      expect(result.plugin).toBeInstanceOf(NetworkedRapierPlugin);
      expect(result.snapshot).toEqual(mockSnapshot);
      expect(scene.enablePhysics).toHaveBeenCalled();
      expect(NetworkedRapierPlugin.prototype.connect).toHaveBeenCalledWith(scene);
    });
  });

  describe('executeStep', () => {
    it('delegates to bodyOps.onExecuteStep', () => {
      // executeStep calls reconciler.getInterpolator() and clockSync.getServerTime()
      (plugin.syncClient as any).getReconciler = vi.fn(() => ({
        getInterpolator: () => ({ resetStats: vi.fn(), getStats: () => ({}) }),
        getInterpolatedRemoteState: () => null,
      }));
      (plugin.syncClient as any).getClockSync = vi.fn(() => ({
        getServerTime: () => 1000,
      }));

      const bodies = [makeMockBody('b1'), makeMockBody('b2')];
      plugin.executeStep(1 / 60, bodies);
    });
  });

  describe('sendMeshBinaryForBody', () => {
    it('delegates to meshOps', () => {
      const body = makeMockBody('meshBody');
      // Should not throw even with no mesh data
      plugin.sendMeshBinaryForBody(body, 'meshBody');
    });
  });

  describe('constraint overrides', () => {
    it('addConstraint calls super and constraintOps', () => {
      const parent = makeMockBody('parent');
      const child = makeMockBody('child');
      const constraint = { _type: 0, _options: {} } as any;
      plugin.bodyToId.set(parent, 'parent');
      plugin.bodyToId.set(child, 'child');

      plugin.addConstraint(parent, child, constraint);

      expect(RapierPlugin.prototype.addConstraint).toHaveBeenCalledWith(parent, child, constraint);
    });

    it('disposeConstraint calls constraintOps then super', () => {
      const constraint = { _type: 0, _options: {} } as any;
      const netId = 'c1';
      plugin.constraintToNetId.set(constraint, netId);
      plugin.localConstraintIds.add(netId);

      plugin.disposeConstraint(constraint);

      expect(plugin.syncClient.removeConstraint).toHaveBeenCalledWith(netId);
      expect(RapierPlugin.prototype.disposeConstraint).toHaveBeenCalledWith(constraint);
    });

    it('setEnabled calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setEnabled(constraint, false);

      expect(RapierPlugin.prototype.setEnabled).toHaveBeenCalledWith(constraint, false);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setCollisionsEnabled calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setCollisionsEnabled(constraint, true);

      expect(RapierPlugin.prototype.setCollisionsEnabled).toHaveBeenCalledWith(constraint, true);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMode calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMode(constraint, 0 as any, 1 as any);

      expect(RapierPlugin.prototype.setAxisMode).toHaveBeenCalledWith(constraint, 0, 1);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMinLimit calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMinLimit(constraint, 1 as any, -5);

      expect(RapierPlugin.prototype.setAxisMinLimit).toHaveBeenCalledWith(constraint, 1, -5);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMaxLimit calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMaxLimit(constraint, 2 as any, 10);

      expect(RapierPlugin.prototype.setAxisMaxLimit).toHaveBeenCalledWith(constraint, 2, 10);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMotorType calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMotorType(constraint, 0 as any, 1 as any);

      expect(RapierPlugin.prototype.setAxisMotorType).toHaveBeenCalledWith(constraint, 0, 1);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMotorTarget calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMotorTarget(constraint, 1 as any, 3.14);

      expect(RapierPlugin.prototype.setAxisMotorTarget).toHaveBeenCalledWith(constraint, 1, 3.14);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisMotorMaxForce calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisMotorMaxForce(constraint, 0 as any, 100);

      expect(RapierPlugin.prototype.setAxisMotorMaxForce).toHaveBeenCalledWith(constraint, 0, 100);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });

    it('setAxisFriction calls super and sends update', () => {
      const constraint = { _type: 0, _options: {} } as any;
      plugin.constraintToNetId.set(constraint, 'c1');

      plugin.setAxisFriction(constraint, 2 as any, 0.5);

      expect(RapierPlugin.prototype.setAxisFriction).toHaveBeenCalledWith(constraint, 2, 0.5);
      expect(plugin.syncClient.updateConstraint).toHaveBeenCalled();
    });
  });

  describe('remaining physics API overrides', () => {
    it('applyAngularImpulse sends input to server', () => {
      const body = makeMockBody('angImpulseBody');
      plugin.bodyToId.set(body, 'angImpulseBody');

      plugin.applyAngularImpulse(body, new MockVector3(0, 1, 0) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });

    it('applyTorque sends input to server', () => {
      const body = makeMockBody('torqueBody');
      plugin.bodyToId.set(body, 'torqueBody');

      plugin.applyTorque(body, new MockVector3(0, 0, 5) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });

    it('setAngularVelocity sends input to server', () => {
      const body = makeMockBody('angVelBody');
      plugin.bodyToId.set(body, 'angVelBody');

      plugin.setAngularVelocity(body, new MockVector3(1, 0, 0) as any);

      expect(plugin.syncClient.sendInput).toHaveBeenCalled();
    });
  });

  describe('async server queries', () => {
    it('shapeCastAsync resolves with hit body', async () => {
      const hitBody = makeMockBody('body1');
      plugin.idToBody.set('body1', hitBody);

      const result = await plugin.shapeCastAsync(
        { type: 'sphere', params: { radius: 1 } },
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );

      expect(result.hit).toBe(true);
      expect(result.hitBody).toBe(hitBody);
      expect(result.fraction).toBe(1.5);
    });

    it('shapeProximityAsync resolves with hit body', async () => {
      const hitBody = makeMockBody('body2');
      plugin.idToBody.set('body2', hitBody);

      const result = await plugin.shapeProximityAsync(
        { type: 'box', params: { halfExtents: { x: 1, y: 1, z: 1 } } },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        5,
      );

      expect(result.hit).toBe(true);
      expect(result.hitBody).toBe(hitBody);
    });

    it('pointProximityAsync resolves without hit body when no hit', async () => {
      const result = await plugin.pointProximityAsync(
        { x: 0, y: 0, z: 0 },
        10,
      );

      expect(result.hit).toBe(false);
      expect(result.hitBody).toBeUndefined();
    });
  });

  describe('handleConstraintAdded', () => {
    it('delegates to constraintOps', () => {
      const descriptor = {
        id: 'c1',
        type: 'ball_socket',
        bodyIdA: 'a',
        bodyIdB: 'b',
        pivotA: { x: 0, y: 0, z: 0 },
        pivotB: { x: 0, y: 0, z: 0 },
      };
      // Should not throw even with missing bodies
      (plugin as any).handleConstraintAdded(descriptor);
    });
  });
});
