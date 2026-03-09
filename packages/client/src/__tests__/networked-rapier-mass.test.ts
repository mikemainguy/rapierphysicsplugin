import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Observable, PhysicsEventType } from '@babylonjs/core';
import type { IPhysicsCollisionEvent } from '@babylonjs/core';
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
    vi.spyOn(RapierPlugin.prototype, 'setMassProperties').mockImplementation(() => {});

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

  it('should use setMassProperties mass over rb.mass() in descriptor', async () => {
    const body = makeMockBody('mass-override-body');
    const shape = makeMockShape();
    const position = makeBjsVector3(0, 1, 0);
    const orientation = makeBjsQuaternion(0, 0, 0, 1);

    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, position, orientation);
    plugin.initShape(shape, PhysicsShapeType.SPHERE as any, { radius: 0.3 });

    // rb.mass() returns 5 (simulating collider-only mass from density*volume)
    plugin.bodyToRigidBody.set(body, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    // setShape queues microtask
    plugin.setShape(body, shape);

    // setMassProperties called after setShape (as PhysicsAggregate does)
    plugin.setMassProperties(body, { mass: 50 } as any);

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(addBodySpy).toHaveBeenCalledOnce();
    const descriptor = addBodySpy.mock.calls[0][0];
    // Should use the explicitly-set mass (50), NOT rb.mass() (5)
    expect(descriptor.mass).toBe(50);
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

describe('NetworkedRapierPlugin bodyIdToPhysicsBody sync', () => {
  let plugin: NetworkedRapierPlugin;

  beforeEach(() => {
    vi.spyOn(RapierPlugin.prototype, 'initBody').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'initShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setShape').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'setMassProperties').mockImplementation(() => {});
    vi.spyOn(RapierPlugin.prototype, 'removeBody').mockImplementation(() => {});

    plugin = new NetworkedRapierPlugin(
      mockRapier,
      makeBjsVector3(0, -9.81, 0),
      { serverUrl: 'ws://localhost', roomId: 'test-room' },
    );

    (plugin as any).syncClient.addBody = vi.fn();
    (plugin as any).syncClient.removeBody = vi.fn();
    vi.spyOn(plugin as any, 'sendMeshBinaryForBody').mockImplementation(() => {});
  });

  it('should register body in bodyIdToPhysicsBody when setShape is called', async () => {
    const body = makeMockBody('sync-test');
    const shape = makeMockShape();

    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shape, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(body, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    plugin.setShape(body, shape);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // bodyIdToPhysicsBody should now contain the body
    expect(plugin.bodyIdToPhysicsBody.get('sync-test')).toBe(body);
  });

  it('should unregister body from bodyIdToPhysicsBody on removeBody', async () => {
    const body = makeMockBody('remove-test');
    const shape = makeMockShape();

    plugin.initBody(body, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shape, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(body, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    plugin.setShape(body, shape);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(plugin.bodyIdToPhysicsBody.has('remove-test')).toBe(true);

    plugin.removeBody(body);

    expect(plugin.bodyIdToPhysicsBody.has('remove-test')).toBe(false);
  });

  it('should fire onCollisionObservable via injectCollisionEvents when bodyIdToPhysicsBody is synced', async () => {
    const bodyA = makeMockBody('body-a');
    const bodyB = makeMockBody('body-b');
    const shapeA = makeMockShape();
    const shapeB = makeMockShape();

    // Register body A
    plugin.initBody(bodyA, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shapeA, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(bodyA, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shapeA, { friction: 0.5, restitution: 0 });
    plugin.setShape(bodyA, shapeA);

    // Register body B
    plugin.initBody(bodyB, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(2, 0, 0), makeBjsQuaternion());
    plugin.initShape(shapeB, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(bodyB, { ...mockRigidBody, handle: 2 } as any);
    plugin.shapeMaterialMap.set(shapeB, { friction: 0.5, restitution: 0 });
    plugin.setShape(bodyB, shapeB);

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // Both bodies should be in bodyIdToPhysicsBody
    expect(plugin.bodyIdToPhysicsBody.get('body-a')).toBe(bodyA);
    expect(plugin.bodyIdToPhysicsBody.get('body-b')).toBe(bodyB);

    // Subscribe to collision observable
    const collisionEvents: IPhysicsCollisionEvent[] = [];
    plugin.onCollisionObservable.add((event) => {
      collisionEvents.push(event);
    });

    // Inject a collision event
    plugin.injectCollisionEvents([{
      bodyIdA: 'body-a',
      bodyIdB: 'body-b',
      type: 'COLLISION_STARTED',
      point: { x: 1, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      impulse: 5,
    }]);

    expect(collisionEvents).toHaveLength(1);
    expect(collisionEvents[0].collider).toBe(bodyA);
    expect(collisionEvents[0].collidedAgainst).toBe(bodyB);
    expect(collisionEvents[0].type).toBe(PhysicsEventType.COLLISION_STARTED);
    expect(collisionEvents[0].impulse).toBe(5);
  });

  it('should handle COLLISION_CONTINUED events via injectCollisionEvents', async () => {
    const bodyA = makeMockBody('cont-a');
    const bodyB = makeMockBody('cont-b');
    const shapeA = makeMockShape();
    const shapeB = makeMockShape();

    plugin.initBody(bodyA, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shapeA, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(bodyA, mockRigidBody as any);
    plugin.shapeMaterialMap.set(shapeA, { friction: 0.5, restitution: 0 });
    plugin.setShape(bodyA, shapeA);

    plugin.initBody(bodyB, PhysicsMotionType.DYNAMIC as any, makeBjsVector3(), makeBjsQuaternion());
    plugin.initShape(shapeB, PhysicsShapeType.SPHERE as any, { radius: 1 });
    plugin.bodyToRigidBody.set(bodyB, { ...mockRigidBody, handle: 2 } as any);
    plugin.shapeMaterialMap.set(shapeB, { friction: 0.5, restitution: 0 });
    plugin.setShape(bodyB, shapeB);

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const collisionEvents: IPhysicsCollisionEvent[] = [];
    plugin.onCollisionObservable.add((event) => {
      collisionEvents.push(event);
    });

    // Inject COLLISION_CONTINUED
    plugin.injectCollisionEvents([{
      bodyIdA: 'cont-a',
      bodyIdB: 'cont-b',
      type: 'COLLISION_CONTINUED',
      point: { x: 0.5, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      impulse: 2,
    }]);

    expect(collisionEvents).toHaveLength(1);
    expect(collisionEvents[0].type).toBe(PhysicsEventType.COLLISION_CONTINUED);
    expect(collisionEvents[0].impulse).toBe(2);
  });
});
