import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RapierPlugin } from '../rapier-plugin.js';
import { NetworkedRapierPlugin } from '../networked-rapier-plugin.js';

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

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

const mockRapier = {
  World: class {
    gravity = { x: 0, y: -9.81, z: 0 };
    timestep = 1 / 60;
    createRigidBody() { return mockRigidBody; }
    createCollider() { return {}; }
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
} as any;

// Minimal BabylonJS-like objects
const PhysicsShapeType = { SPHERE: 0, CAPSULE: 1, BOX: 3, MESH: 6 };
const PhysicsMotionType = { STATIC: 0, ANIMATED: 1, DYNAMIC: 2 };

function makeMockBody(name: string) {
  return {
    transformNode: {
      name,
      getScene: () => null,
      metadata: null,
    },
    _pluginData: {},
    shape: null,
  } as any;
}

function makeMockShape() {
  return {} as any;
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

describe('NetworkedRapierPlugin mass in descriptor', () => {
  let plugin: NetworkedRapierPlugin;
  let addBodySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Stub RapierPlugin parent methods to avoid real Rapier calls
    vi.spyOn(RapierPlugin.prototype, 'initBody').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'initShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setShape').mockImplementation(() => {});

    plugin = new NetworkedRapierPlugin(
      mockRapier,
      makeBjsVector3(0, -9.81, 0),
      { serverUrl: 'ws://localhost', roomId: 'test-room' },
    );

    // Replace the private syncClient.addBody with a spy
    addBodySpy = vi.fn();
    (plugin as any).syncClient.addBody = addBodySpy;

    // Stub sendMeshBinaryForBody to avoid mesh encoding
    vi.spyOn(plugin as any, 'sendMeshBinaryForBody').mockImplementation(() => {});
  });

  it('should include mass, friction, and restitution in the body descriptor sent to syncClient', async () => {
    const body = makeMockBody('test-body');
    const shape = makeMockShape();
    const position = makeBjsVector3(1, 2, 3);
    const orientation = makeBjsQuaternion(0, 0, 0, 1);

    // Step 1: initBody — stores in pendingBodies
    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, position, orientation);

    // Step 2: initShape — stores in shapeParamsCache
    plugin.initShape(shape, PhysicsShapeType.BOX as any, {
      extents: makeBjsVector3(2, 2, 2),
    });

    // Step 3: Populate internal maps that buildDescriptor reads.
    // These would normally be set by super.initBody / super.setShape.
    plugin.bodyToRigidBody.set(body, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shape, { friction: 0.3, restitution: 0.7 });

    // Step 4: setShape — queues microtask that calls buildDescriptor + addBody
    plugin.setShape(body, shape);

    // Step 5: Flush microtask
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // Step 6: Assert
    expect(addBodySpy).toHaveBeenCalledOnce();
    const descriptor = addBodySpy.mock.calls[0][0];
    expect(descriptor.id).toBe('test-body');
    expect(descriptor.mass).toBe(5);
    expect(descriptor.friction).toBe(0.3);
    expect(descriptor.restitution).toBe(0.7);
    expect(descriptor.motionType).toBe('dynamic');
    expect(descriptor.shape.type).toBe('box');
    expect(descriptor.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('should default mass to undefined when no rigid body is mapped', async () => {
    const body = makeMockBody('no-rb-body');
    const shape = makeMockShape();

    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shape, PhysicsShapeType.SPHERE as any, { radius: 1 });
    // Intentionally do NOT set bodyToRigidBody
    plugin.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    plugin.setShape(body, shape);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(addBodySpy).toHaveBeenCalledOnce();
    const descriptor = addBodySpy.mock.calls[0][0];
    expect(descriptor.mass).toBeUndefined();
  });
});
