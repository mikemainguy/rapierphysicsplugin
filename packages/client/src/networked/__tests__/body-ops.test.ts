import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhysicsMotionType, PhysicsShapeType, Vector3 } from '@babylonjs/core';
import type { NetworkedPluginState } from '../types.js';
import {
  onInitBody,
  onInitShape,
  onSetShape,
  onSetMassProperties,
  onSync,
  onRemoveBody,
  buildDescriptor,
  shapeInfoToDescriptor,
} from '../body-ops.js';

// --- Mock helpers ---

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

function makeBjsVector3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set: vi.fn(),
    clone: () => makeBjsVector3(x, y, z),
  } as any;
}

function makeBjsQuaternion(x = 0, y = 0, z = 0, w = 1) {
  return {
    x, y, z, w,
    set: vi.fn(),
    clone: () => makeBjsQuaternion(x, y, z, w),
  } as any;
}

function makeMockBody(name: string, metadata: any = null) {
  return {
    transformNode: {
      name,
      position: makeBjsVector3(),
      rotationQuaternion: null as any,
      getScene: () => ({ name: 'mock-scene' }),
      metadata,
      isDisposed: vi.fn(() => false),
      dispose: vi.fn(),
    },
    _pluginData: {},
    shape: null,
  } as any;
}

function makeMockShape() {
  return {} as any;
}

function makeNetworkedState(overrides: Partial<NetworkedPluginState> = {}): NetworkedPluginState {
  return {
    rapier: {
      Vector3: MockVector3,
      Quaternion: MockQuaternion,
    } as any,
    world: {} as any,
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
    activeCollisionPairs: new Set(),
    onCollisionObservable: { notifyObservers: vi.fn() } as any,
    onCollisionEndedObservable: { notifyObservers: vi.fn() } as any,
    onTriggerCollisionObservable: { notifyObservers: vi.fn() } as any,
    eventQueue: {
      drainCollisionEvents: vi.fn(),
      drainContactForceEvents: vi.fn(),
    } as any,
    syncClient: {
      addBody: vi.fn(),
      removeBody: vi.fn(),
      getClockSync: vi.fn(() => ({ getServerTime: vi.fn(() => Date.now()) })),
      getReconciler: vi.fn(() => ({
        getInterpolator: vi.fn(() => ({ resetStats: vi.fn() })),
        getInterpolatedRemoteState: vi.fn(() => null),
      })),
      getClientId: vi.fn(() => 'client-1'),
    } as any,
    scene: null,
    bodyToId: new Map(),
    idToBody: new Map(),
    pendingBodies: new Map(),
    shapeParamsCache: new Map(),
    pendingDescriptors: new Map(),
    remoteBodyCreationIds: new Set(),
    remoteBodies: new Set(),
    geometryCache: new Map(),
    sentGeometryHashes: new Set(),
    materialCache: new Map(),
    textureCache: new Map(),
    sentMaterialHashes: new Set(),
    sentTextureHashes: new Set(),
    textureObjectUrls: new Map(),
    constraintToNetId: new Map(),
    localConstraintIds: new Set(),
    remoteConstraintJoints: new Map(),
    bodyMassOverride: new Map(),
    collisionCount: 0,
    config: { serverUrl: 'ws://localhost', roomId: 'test' } as any,
    simulationResetCallbacks: [],
    stateUpdateCallbacks: [],
    ...overrides,
  };
}

describe('onInitBody', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should add body to pendingBodies when no remote creation is in progress', () => {
    const body = makeMockBody('test');
    const pos = makeBjsVector3(1, 2, 3);
    const rot = makeBjsQuaternion(0, 0, 0, 1);

    onInitBody(state, body, PhysicsMotionType.DYNAMIC, pos, rot);

    expect(state.pendingBodies.has(body)).toBe(true);
    const pending = state.pendingBodies.get(body)!;
    expect(pending.motionType).toBe(PhysicsMotionType.DYNAMIC);
    expect(pending.position.x).toBe(1);
    expect(pending.orientation.w).toBe(1);
  });

  it('should not add to pendingBodies during remote body creation', () => {
    state.remoteBodyCreationIds.add('some-remote-id');
    const body = makeMockBody('remote');

    onInitBody(state, body, PhysicsMotionType.DYNAMIC, makeBjsVector3(), makeBjsQuaternion());

    expect(state.pendingBodies.has(body)).toBe(false);
  });

  it('should capture scene from body transformNode', () => {
    expect(state.scene).toBeNull();
    const body = makeMockBody('scene-capture');

    onInitBody(state, body, PhysicsMotionType.DYNAMIC, makeBjsVector3(), makeBjsQuaternion());

    expect(state.scene).not.toBeNull();
  });

  it('should not overwrite scene if already set', () => {
    const existingScene = { name: 'existing' } as any;
    state.scene = existingScene;
    const body = makeMockBody('no-overwrite');

    onInitBody(state, body, PhysicsMotionType.DYNAMIC, makeBjsVector3(), makeBjsQuaternion());

    expect(state.scene).toBe(existingScene);
  });
});

describe('onInitShape', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should cache shape type and options', () => {
    const shape = makeMockShape();
    const options = { extents: makeBjsVector3(2, 2, 2) };

    onInitShape(state, shape, PhysicsShapeType.BOX, options as any);

    expect(state.shapeParamsCache.has(shape)).toBe(true);
    const cached = state.shapeParamsCache.get(shape)!;
    expect(cached.type).toBe(PhysicsShapeType.BOX);
    expect(cached.options).toBe(options);
  });
});

describe('onSetShape', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should register body ID mappings and queue descriptor send via microtask', async () => {
    const body = makeMockBody('set-shape-body');
    const shape = makeMockShape();

    // Set up pending body and shape cache
    state.pendingBodies.set(body, {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(1, 2, 3),
      orientation: makeBjsQuaternion(0, 0, 0, 1),
    });
    state.shapeParamsCache.set(shape, {
      type: PhysicsShapeType.SPHERE,
      options: { radius: 0.5 },
    });
    state.bodyToRigidBody.set(body, { mass: () => 5 } as any);
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0.3 });

    const sendMesh = vi.fn();
    onSetShape(state, body, shape, sendMesh);

    // ID mappings should be set immediately
    expect(state.bodyToId.get(body)).toBe('set-shape-body');
    expect(state.idToBody.get('set-shape-body')).toBe(body);
    expect(state.bodyIdToPhysicsBody.get('set-shape-body')).toBe(body);

    // Pending should have been removed
    expect(state.pendingBodies.has(body)).toBe(false);

    // Flush microtask
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // syncClient.addBody should have been called
    expect(state.syncClient.addBody).toHaveBeenCalledOnce();
    expect(sendMesh).toHaveBeenCalledWith(body, 'set-shape-body');
  });

  it('should not send descriptor during remote body creation', async () => {
    state.remoteBodyCreationIds.add('remote-id');
    const body = makeMockBody('remote-body');
    const shape = makeMockShape();

    onSetShape(state, body, shape, vi.fn());

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(state.syncClient.addBody).not.toHaveBeenCalled();
  });

  it('should not send descriptor when shape is null', async () => {
    const body = makeMockBody('null-shape');
    onSetShape(state, body, null, vi.fn());

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(state.syncClient.addBody).not.toHaveBeenCalled();
  });

  it('should not send descriptor when no pending body info exists', async () => {
    const body = makeMockBody('no-pending');
    const shape = makeMockShape();
    state.shapeParamsCache.set(shape, { type: PhysicsShapeType.BOX, options: { extents: makeBjsVector3(1, 1, 1) } });

    onSetShape(state, body, shape, vi.fn());

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(state.syncClient.addBody).not.toHaveBeenCalled();
  });

  it('should use crypto.randomUUID when body has no name', async () => {
    const body = makeMockBody('');
    body.transformNode.name = '';
    const shape = makeMockShape();

    state.pendingBodies.set(body, {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    });
    state.shapeParamsCache.set(shape, { type: PhysicsShapeType.SPHERE, options: { radius: 1 } });
    state.bodyToRigidBody.set(body, { mass: () => 1 } as any);
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    onSetShape(state, body, shape, vi.fn());

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // The body ID should be a UUID (non-empty since name was empty)
    const bodyId = state.bodyToId.get(body)!;
    expect(bodyId).toBeTruthy();
    expect(bodyId.length).toBeGreaterThan(0);
  });

  it('should unregister body when descriptor build fails (unsupported shape)', async () => {
    const body = makeMockBody('fail-body');
    const shape = makeMockShape();

    state.pendingBodies.set(body, {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    });
    // Use MESH type without mesh data — will return null descriptor
    state.shapeParamsCache.set(shape, { type: PhysicsShapeType.MESH, options: {} });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    onSetShape(state, body, shape, vi.fn());

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(state.syncClient.addBody).not.toHaveBeenCalled();
    expect(state.bodyToId.has(body)).toBe(false);
    expect(state.idToBody.has('fail-body')).toBe(false);
    expect(state.bodyIdToPhysicsBody.has('fail-body')).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('onSetMassProperties', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should store mass override', () => {
    const body = makeMockBody('mass');
    onSetMassProperties(state, body, { mass: 42 } as any);
    expect(state.bodyMassOverride.get(body)).toBe(42);
  });

  it('should not store override when mass is undefined', () => {
    const body = makeMockBody('no-mass');
    onSetMassProperties(state, body, {} as any);
    expect(state.bodyMassOverride.has(body)).toBe(false);
  });
});

describe('onSync', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should return true for networked bodies', () => {
    const body = makeMockBody('synced');
    state.bodyToId.set(body, 'synced');
    expect(onSync(state, body)).toBe(true);
  });

  it('should return false for non-networked bodies', () => {
    const body = makeMockBody('local');
    expect(onSync(state, body)).toBe(false);
  });
});

describe('onRemoveBody', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should call syncClient.removeBody and clean up all maps', () => {
    const body = makeMockBody('remove-me');
    const bodyId = 'remove-me';

    state.bodyToId.set(body, bodyId);
    state.idToBody.set(bodyId, body);
    state.bodyIdToPhysicsBody.set(bodyId, body);
    state.remoteBodies.add(bodyId);
    state.pendingBodies.set(body, {} as any);
    state.bodyMassOverride.set(body, 10);

    onRemoveBody(state, body);

    expect(state.syncClient.removeBody).toHaveBeenCalledWith(bodyId);
    expect(body.transformNode.dispose).toHaveBeenCalled();
    expect(state.bodyToId.has(body)).toBe(false);
    expect(state.idToBody.has(bodyId)).toBe(false);
    expect(state.bodyIdToPhysicsBody.has(bodyId)).toBe(false);
    expect(state.remoteBodies.has(bodyId)).toBe(false);
    expect(state.pendingBodies.has(body)).toBe(false);
    expect(state.bodyMassOverride.has(body)).toBe(false);
  });

  it('should be a no-op when body has no ID mapping', () => {
    const body = makeMockBody('unknown');
    onRemoveBody(state, body);
    expect(state.syncClient.removeBody).not.toHaveBeenCalled();
  });

  it('should not dispose an already-disposed transform node', () => {
    const body = makeMockBody('disposed');
    body.transformNode.isDisposed = vi.fn(() => true);
    state.bodyToId.set(body, 'disposed');
    state.idToBody.set('disposed', body);

    onRemoveBody(state, body);

    expect(body.transformNode.dispose).not.toHaveBeenCalled();
  });
});

describe('buildDescriptor', () => {
  let state: NetworkedPluginState;

  beforeEach(() => {
    state = makeNetworkedState();
  });

  it('should build a complete body descriptor', () => {
    const body = makeMockBody('desc-body');
    const shape = makeMockShape();
    const rb = { mass: () => 5 } as any;

    state.bodyToRigidBody.set(body, rb);
    state.shapeMaterialMap.set(shape, { friction: 0.3, restitution: 0.7 });

    const pending = {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(1, 2, 3),
      orientation: makeBjsQuaternion(0, 0, 0, 1),
    };
    const shapeInfo = { type: PhysicsShapeType.SPHERE as any, options: { radius: 0.5 } };

    const desc = buildDescriptor(state, body, 'desc-body', pending, shapeInfo, shape);

    expect(desc).not.toBeNull();
    expect(desc!.id).toBe('desc-body');
    expect(desc!.motionType).toBe('dynamic');
    expect(desc!.shape.type).toBe('sphere');
    expect(desc!.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(desc!.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(desc!.mass).toBe(5);
    expect(desc!.friction).toBe(0.3);
    expect(desc!.restitution).toBe(0.7);
  });

  it('should prefer mass override over rb.mass()', () => {
    const body = makeMockBody('override');
    const shape = makeMockShape();
    state.bodyToRigidBody.set(body, { mass: () => 5 } as any);
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });
    state.bodyMassOverride.set(body, 100);

    const pending = {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    };
    const shapeInfo = { type: PhysicsShapeType.SPHERE as any, options: { radius: 1 } };

    const desc = buildDescriptor(state, body, 'override', pending, shapeInfo, shape);

    expect(desc!.mass).toBe(100);
  });

  it('should return undefined mass when no rigid body and no override', () => {
    const body = makeMockBody('no-rb');
    const shape = makeMockShape();
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    const pending = {
      motionType: PhysicsMotionType.STATIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    };
    const shapeInfo = { type: PhysicsShapeType.BOX as any, options: { extents: makeBjsVector3(1, 1, 1) } };

    const desc = buildDescriptor(state, body, 'no-rb', pending, shapeInfo, shape);

    expect(desc!.mass).toBeUndefined();
  });

  it('should return null when shape cannot be serialized', () => {
    const body = makeMockBody('bad-shape');
    const shape = makeMockShape();

    const pending = {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    };
    const shapeInfo = { type: PhysicsShapeType.MESH as any, options: {} };

    const desc = buildDescriptor(state, body, 'bad-shape', pending, shapeInfo, shape);
    expect(desc).toBeNull();
  });

  it('should set ownerId when metadata.owned is true', () => {
    const body = makeMockBody('owned', { owned: true });
    const shape = makeMockShape();
    state.bodyToRigidBody.set(body, { mass: () => 1 } as any);
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    const pending = {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    };
    const shapeInfo = { type: PhysicsShapeType.SPHERE as any, options: { radius: 1 } };

    const desc = buildDescriptor(state, body, 'owned', pending, shapeInfo, shape);

    expect(desc!.ownerId).toBe('client-1');
  });

  it('should not set ownerId when metadata.owned is falsy', () => {
    const body = makeMockBody('not-owned');
    const shape = makeMockShape();
    state.bodyToRigidBody.set(body, { mass: () => 1 } as any);
    state.shapeMaterialMap.set(shape, { friction: 0.5, restitution: 0 });

    const pending = {
      motionType: PhysicsMotionType.DYNAMIC,
      position: makeBjsVector3(),
      orientation: makeBjsQuaternion(),
    };
    const shapeInfo = { type: PhysicsShapeType.SPHERE as any, options: { radius: 1 } };

    const desc = buildDescriptor(state, body, 'not-owned', pending, shapeInfo, shape);

    expect(desc!.ownerId).toBeUndefined();
  });
});

describe('shapeInfoToDescriptor', () => {
  it('should convert BOX shape', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.BOX,
      options: { extents: makeBjsVector3(4, 6, 8) },
    });

    expect(desc).not.toBeNull();
    expect(desc!.type).toBe('box');
    expect(desc!.params.halfExtents).toEqual({ x: 2, y: 3, z: 4 });
  });

  it('should use default extents for BOX when not provided', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.BOX,
      options: {},
    });

    expect(desc!.params.halfExtents).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
  });

  it('should convert SPHERE shape', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.SPHERE,
      options: { radius: 2.5 },
    });

    expect(desc!.type).toBe('sphere');
    expect(desc!.params.radius).toBe(2.5);
  });

  it('should use default radius for SPHERE when not provided', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.SPHERE,
      options: {},
    });

    expect(desc!.params.radius).toBe(0.5);
  });

  it('should convert CAPSULE shape', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.CAPSULE,
      options: {
        pointA: new Vector3(0, 0, 0),
        pointB: new Vector3(0, 4, 0),
        radius: 0.3,
      },
    });

    expect(desc!.type).toBe('capsule');
    expect(desc!.params.halfHeight).toBeCloseTo(2);
    expect(desc!.params.radius).toBe(0.3);
  });

  it('should convert CYLINDER shape', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.CYLINDER,
      options: {
        pointA: new Vector3(0, -1, 0),
        pointB: new Vector3(0, 1, 0),
        radius: 0.5,
      },
    });

    expect(desc!.type).toBe('cylinder');
    expect(desc!.params.halfHeight).toBeCloseTo(1);
    expect(desc!.params.radius).toBe(0.5);
  });

  it('should convert MESH shape with valid mesh data', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.MESH,
      options: {
        mesh: {
          getVerticesData: vi.fn(() => [0, 0, 0, 1, 0, 0, 0, 1, 0]),
          getIndices: vi.fn(() => [0, 1, 2]),
        },
      },
    });

    expect(desc!.type).toBe('mesh');
    expect(desc!.params.vertices).toBeInstanceOf(Float32Array);
    expect(desc!.params.indices).toBeInstanceOf(Uint32Array);
  });

  it('should return null for MESH shape without mesh data', () => {
    expect(shapeInfoToDescriptor({
      type: PhysicsShapeType.MESH,
      options: {},
    })).toBeNull();
  });

  it('should return null for MESH shape with missing vertex/index data', () => {
    expect(shapeInfoToDescriptor({
      type: PhysicsShapeType.MESH,
      options: {
        mesh: {
          getVerticesData: vi.fn(() => null),
          getIndices: vi.fn(() => null),
        },
      },
    })).toBeNull();
  });

  it('should convert CONVEX_HULL shape', () => {
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.CONVEX_HULL,
      options: {
        mesh: {
          getVerticesData: vi.fn(() => [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
        },
      },
    });

    expect(desc!.type).toBe('convex_hull');
    expect(desc!.params.vertices).toBeInstanceOf(Float32Array);
  });

  it('should return null for CONVEX_HULL without mesh', () => {
    expect(shapeInfoToDescriptor({
      type: PhysicsShapeType.CONVEX_HULL,
      options: {},
    })).toBeNull();
  });

  it('should convert HEIGHTFIELD shape with explicit data', () => {
    const heights = new Float32Array([0, 1, 2, 3]);
    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.HEIGHTFIELD,
      options: {
        heightFieldData: heights,
        numHeightFieldSamplesX: 2,
        numHeightFieldSamplesZ: 2,
        heightFieldSizeX: 10,
        heightFieldSizeZ: 10,
      },
    });

    expect(desc!.type).toBe('heightfield');
    expect(desc!.params.heights).toBe(heights);
    expect(desc!.params.numSamplesX).toBe(2);
    expect(desc!.params.numSamplesZ).toBe(2);
    expect(desc!.params.sizeX).toBe(10);
    expect(desc!.params.sizeZ).toBe(10);
  });

  it('should extract heightfield from groundMesh', () => {
    const positions = new Float32Array([
      // 2x2 grid: 4 vertices, each with x,y,z
      -5, 0, -5,
      5, 1, -5,
      -5, 2, 5,
      5, 3, 5,
    ]);
    const groundMesh = {
      _subdivisionsX: 1,
      _subdivisionsY: 1,
      getVerticesData: vi.fn(() => positions),
      getBoundingInfo: () => ({
        boundingBox: {
          maximum: { x: 5, y: 3, z: 5 },
          minimum: { x: -5, y: 0, z: -5 },
        },
      }),
    };

    const desc = shapeInfoToDescriptor({
      type: PhysicsShapeType.HEIGHTFIELD,
      options: { groundMesh } as any,
    });

    expect(desc!.type).toBe('heightfield');
    expect(desc!.params.numSamplesX).toBe(2);
    expect(desc!.params.numSamplesZ).toBe(2);
    expect(desc!.params.sizeX).toBe(10);
    expect(desc!.params.sizeZ).toBe(10);
    expect(desc!.params.heights).toBeInstanceOf(Float32Array);
  });

  it('should return null for HEIGHTFIELD with no data', () => {
    expect(shapeInfoToDescriptor({
      type: PhysicsShapeType.HEIGHTFIELD,
      options: {},
    })).toBeNull();
  });

  it('should convert CONTAINER shape with children', () => {
    const childShape = makeMockShape();
    const state = makeNetworkedState();
    const parentShape = makeMockShape();

    state.shapeParamsCache.set(childShape, {
      type: PhysicsShapeType.SPHERE,
      options: { radius: 0.5 },
    });
    state.compoundChildren.set(parentShape, [
      {
        child: childShape,
        translation: makeBjsVector3(1, 0, 0),
        rotation: makeBjsQuaternion(0, 0, 0, 1),
      },
    ]);

    const desc = shapeInfoToDescriptor(
      { type: PhysicsShapeType.CONTAINER, options: {} },
      state,
      parentShape,
    );

    expect(desc!.type).toBe('container');
    expect(desc!.params.children).toHaveLength(1);
    expect(desc!.params.children[0].shape.type).toBe('sphere');
    expect(desc!.params.children[0].translation).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('should return null for CONTAINER with no children', () => {
    const state = makeNetworkedState();
    const parentShape = makeMockShape();
    state.compoundChildren.set(parentShape, []);

    const desc = shapeInfoToDescriptor(
      { type: PhysicsShapeType.CONTAINER, options: {} },
      state,
      parentShape,
    );

    expect(desc).toBeNull();
  });

  it('should return null for CONTAINER without state', () => {
    expect(shapeInfoToDescriptor({
      type: PhysicsShapeType.CONTAINER,
      options: {},
    })).toBeNull();
  });

  it('should return null for unknown shape type', () => {
    expect(shapeInfoToDescriptor({
      type: 999 as any,
      options: {},
    })).toBeNull();
  });
});
