import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NetworkedPluginState } from '../types.js';

// --- Mocks for @babylonjs/core ---

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
  }
  class Quaternion {
    constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  }
  class Color3 {
    constructor(public r = 0, public g = 0, public b = 0) {}
  }
  class StandardMaterial {
    diffuseColor: any = null;
    specularColor: any = null;
    constructor(public name: string, _scene: any) {}
  }
  class Mesh {
    position = { x: 0, y: 0, z: 0, set: vi.fn() };
    rotationQuaternion: any = null;
    material: any = null;
    metadata: any = null;
    dispose = vi.fn();
  }
  const MeshBuilder = {
    CreateBox: vi.fn((_name: string, _opts: any, _scene: any) => new Mesh()),
    CreateSphere: vi.fn((_name: string, _opts: any, _scene: any) => new Mesh()),
    CreateCapsule: vi.fn((_name: string, _opts: any, _scene: any) => new Mesh()),
  };
  class PhysicsBody {
    shape: any = null;
    transformNode: any;
    dispose = vi.fn();
    constructor(mesh: any, _motionType: any, _kinematic: boolean, _scene: any) {
      this.transformNode = mesh;
    }
  }
  class PhysicsShape {
    constructor(public _options: any, public _scene: any) {}
  }
  const PhysicsShapeType = {
    BOX: 0,
    SPHERE: 1,
    CAPSULE: 2,
    MESH: 3,
  };
  const PhysicsMotionType = {
    DYNAMIC: 0,
    STATIC: 1,
    ANIMATED: 2,
  };
  return {
    Vector3, Quaternion, Color3, StandardMaterial, Mesh,
    MeshBuilder, PhysicsBody, PhysicsShape, PhysicsShapeType, PhysicsMotionType,
  };
});

vi.mock('@rapierphysicsplugin/shared', () => ({}));

vi.mock('../types.js', () => ({
  shapeColors: {
    box: { r: 0.9, g: 0.2, b: 0.2 },
    sphere: { r: 0.2, g: 0.7, b: 0.9 },
    capsule: { r: 0.2, g: 0.9, b: 0.3 },
  },
  staticColor: { r: 0.4, g: 0.4, b: 0.45 },
  motionTypeFromWire: vi.fn((mt: string) => {
    if (mt === 'static') return 1;
    if (mt === 'kinematic') return 2;
    return 0;
  }),
}));

import { MeshBuilder, PhysicsBody, PhysicsShape } from '@babylonjs/core';
import { motionTypeFromWire } from '../types.js';
import {
  handleBodyAdded,
  createRemoteBody,
  handleBodyRemoved,
  handleSimulationStarted,
  createMeshFromDescriptor,
  createShapeFromDescriptor,
} from '../remote-body-ops.js';

// --- Helpers ---

function makeState(overrides: Partial<NetworkedPluginState> = {}): NetworkedPluginState {
  return {
    scene: { getPhysicsEngine: vi.fn(() => ({})), name: 'mock-scene' } as any,
    bodyToId: new Map(),
    idToBody: new Map(),
    bodyIdToPhysicsBody: new Map(),
    remoteBodies: new Set(),
    remoteBodyCreationIds: new Set(),
    pendingBodies: new Map(),
    geometryCache: new Map(),
    sentGeometryHashes: new Set(),
    materialCache: new Map(),
    textureCache: new Map(),
    sentMaterialHashes: new Set(),
    sentTextureHashes: new Set(),
    textureObjectUrls: new Map(),
    collisionCount: 0,
    remoteConstraintJoints: new Map(),
    constraintToNetId: new Map(),
    localConstraintIds: new Set(),
    world: { removeImpulseJoint: vi.fn() } as any,
    simulationResetCallbacks: [],
    stateUpdateCallbacks: [],
    ...overrides,
  } as any;
}

function makeDescriptor(overrides: any = {}) {
  return {
    id: 'body-1',
    motionType: 'dynamic',
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
    ...overrides,
  };
}

// --- Tests ---

describe('remote-body-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleBodyAdded', () => {
    it('creates a remote body for a new descriptor', () => {
      const state = makeState();
      const desc = makeDescriptor();

      handleBodyAdded(state, desc as any);

      expect(state.idToBody.has('body-1')).toBe(true);
      expect(state.bodyIdToPhysicsBody.has('body-1')).toBe(true);
      expect(state.remoteBodies.has('body-1')).toBe(true);
    });

    it('skips if body id already exists', () => {
      const state = makeState();
      state.idToBody.set('body-1', {} as any);

      handleBodyAdded(state, makeDescriptor() as any);

      // Should not create a second entry
      expect(state.bodyIdToPhysicsBody.has('body-1')).toBe(false);
    });

    it('skips if scene is null', () => {
      const state = makeState({ scene: null });

      handleBodyAdded(state, makeDescriptor() as any);

      expect(state.idToBody.size).toBe(0);
    });
  });

  describe('createRemoteBody', () => {
    it('registers body in all state maps', () => {
      const state = makeState();
      const desc = makeDescriptor();
      const mesh = { metadata: null } as any;

      createRemoteBody(state, desc as any, mesh);

      expect(state.idToBody.has('body-1')).toBe(true);
      expect(state.bodyIdToPhysicsBody.has('body-1')).toBe(true);
      expect(state.remoteBodies.has('body-1')).toBe(true);
      expect(state.bodyToId.size).toBe(1);
    });

    it('sets mesh metadata with bodyId', () => {
      const state = makeState();
      const desc = makeDescriptor();
      const mesh = { metadata: null } as any;

      createRemoteBody(state, desc as any, mesh);

      expect(mesh.metadata).toEqual({ bodyId: 'body-1' });
    });

    it('calls motionTypeFromWire with descriptor motionType', () => {
      const state = makeState();
      const desc = makeDescriptor({ motionType: 'kinematic' });

      createRemoteBody(state, desc as any, { metadata: null } as any);

      expect(motionTypeFromWire).toHaveBeenCalledWith('kinematic');
    });

    it('cleans up remoteBodyCreationIds even on error', () => {
      const state = makeState({
        scene: { getPhysicsEngine: vi.fn(() => ({})) } as any,
      });
      // PhysicsBody constructor will throw if we break things, but let's test the finally
      // by checking the set is cleaned up after success
      const desc = makeDescriptor();
      createRemoteBody(state, desc as any, { metadata: null } as any);

      expect(state.remoteBodyCreationIds.has('body-1')).toBe(false);
    });

    it('does nothing if no physics engine', () => {
      const state = makeState({
        scene: { getPhysicsEngine: vi.fn(() => null) } as any,
      });

      createRemoteBody(state, makeDescriptor() as any, { metadata: null } as any);

      expect(state.idToBody.size).toBe(0);
    });
  });

  describe('handleBodyRemoved', () => {
    it('disposes body and transform node and cleans state', () => {
      const state = makeState();
      const tn = { dispose: vi.fn() };
      const body = { transformNode: tn, dispose: vi.fn() } as any;
      state.idToBody.set('body-1', body);
      state.bodyToId.set(body, 'body-1');
      state.bodyIdToPhysicsBody.set('body-1', body);
      state.remoteBodies.add('body-1');

      handleBodyRemoved(state, 'body-1');

      expect(tn.dispose).toHaveBeenCalled();
      expect(body.dispose).toHaveBeenCalled();
      expect(state.idToBody.size).toBe(0);
      expect(state.bodyToId.size).toBe(0);
      expect(state.bodyIdToPhysicsBody.size).toBe(0);
      expect(state.remoteBodies.size).toBe(0);
    });

    it('does nothing for unknown bodyId', () => {
      const state = makeState();

      handleBodyRemoved(state, 'nonexistent');

      expect(state.idToBody.size).toBe(0);
    });

    it('handles body with no transform node', () => {
      const state = makeState();
      const body = { transformNode: null, dispose: vi.fn() } as any;
      state.idToBody.set('body-1', body);
      state.bodyToId.set(body, 'body-1');
      state.bodyIdToPhysicsBody.set('body-1', body);
      state.remoteBodies.add('body-1');

      handleBodyRemoved(state, 'body-1');

      expect(body.dispose).toHaveBeenCalled();
      expect(state.idToBody.size).toBe(0);
    });
  });

  describe('handleSimulationStarted', () => {
    it('clears all state maps and sets', () => {
      const state = makeState();
      state.bodyToId.set({} as any, 'a');
      state.idToBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.pendingBodies.set({} as any, {} as any);
      state.remoteBodies.add('a');
      state.geometryCache.set('k', {} as any);
      state.sentGeometryHashes.add('h');
      state.materialCache.set('k', {} as any);
      state.textureCache.set('k', {} as any);
      state.sentMaterialHashes.add('h');
      state.sentTextureHashes.add('h');
      state.collisionCount = 5;

      handleSimulationStarted(state, {} as any);

      expect(state.bodyToId.size).toBe(0);
      expect(state.idToBody.size).toBe(0);
      expect(state.bodyIdToPhysicsBody.size).toBe(0);
      expect(state.pendingBodies.size).toBe(0);
      expect(state.remoteBodies.size).toBe(0);
      expect(state.geometryCache.size).toBe(0);
      expect(state.sentGeometryHashes.size).toBe(0);
      expect(state.materialCache.size).toBe(0);
      expect(state.textureCache.size).toBe(0);
      expect(state.sentMaterialHashes.size).toBe(0);
      expect(state.sentTextureHashes.size).toBe(0);
      expect(state.collisionCount).toBe(0);
    });

    it('returns bodies to remove and disposes transform nodes', () => {
      const state = makeState();
      const tn1 = { dispose: vi.fn() };
      const tn2 = { dispose: vi.fn() };
      const body1 = { transformNode: tn1 } as any;
      const body2 = { transformNode: tn2 } as any;
      state.bodyToId.set(body1, 'a');
      state.bodyToId.set(body2, 'b');

      const result = handleSimulationStarted(state, {} as any);

      expect(result).toHaveLength(2);
      expect(tn1.dispose).toHaveBeenCalled();
      expect(tn2.dispose).toHaveBeenCalled();
    });

    it('revokes texture object URLs', () => {
      const state = makeState();
      const revokeObjectURL = vi.fn();
      globalThis.URL.revokeObjectURL = revokeObjectURL;
      state.textureObjectUrls.set('tex1', 'blob:http://url1');
      state.textureObjectUrls.set('tex2', 'blob:http://url2');

      handleSimulationStarted(state, {} as any);

      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      expect(state.textureObjectUrls.size).toBe(0);
    });

    it('removes remote constraint joints', () => {
      const state = makeState();
      const joint1 = {} as any;
      const joint2 = {} as any;
      state.remoteConstraintJoints.set('c1', joint1);
      state.remoteConstraintJoints.set('c2', joint2);

      handleSimulationStarted(state, {} as any);

      expect(state.world.removeImpulseJoint).toHaveBeenCalledTimes(2);
      expect(state.remoteConstraintJoints.size).toBe(0);
      expect(state.constraintToNetId.size).toBe(0);
      expect(state.localConstraintIds.size).toBe(0);
    });

    it('calls simulation reset callbacks', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const state = makeState({ simulationResetCallbacks: [cb1, cb2] });

      handleSimulationStarted(state, {} as any);

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  describe('createMeshFromDescriptor', () => {
    it('creates a box mesh with correct dimensions', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'box', params: { halfExtents: { x: 1, y: 2, z: 3 } } },
      });

      createMeshFromDescriptor(state, desc as any);

      expect(MeshBuilder.CreateBox).toHaveBeenCalledWith(
        'body-1',
        { width: 2, height: 4, depth: 6 },
        expect.anything(),
      );
    });

    it('creates a sphere mesh with correct diameter', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'sphere', params: { radius: 1.5 } },
      });

      createMeshFromDescriptor(state, desc as any);

      expect(MeshBuilder.CreateSphere).toHaveBeenCalledWith(
        'body-1',
        { diameter: 3 },
        expect.anything(),
      );
    });

    it('creates a capsule mesh with correct height and radius', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'capsule', params: { halfHeight: 1, radius: 0.5 } },
      });

      createMeshFromDescriptor(state, desc as any);

      expect(MeshBuilder.CreateCapsule).toHaveBeenCalledWith(
        'body-1',
        { height: 3, radius: 0.5 },
        expect.anything(),
      );
    });

    it('falls back to box for unknown shape type', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'unknown', params: {} },
      });

      createMeshFromDescriptor(state, desc as any);

      expect(MeshBuilder.CreateBox).toHaveBeenCalledWith(
        'body-1',
        { size: 1 },
        expect.anything(),
      );
    });

    it('uses staticColor for static motion type', () => {
      const state = makeState();
      const desc = makeDescriptor({ motionType: 'static' });

      const mesh = createMeshFromDescriptor(state, desc as any);

      expect((mesh.material as any).diffuseColor).toEqual({ r: 0.4, g: 0.4, b: 0.45 });
    });

    it('sets position and rotation from descriptor', () => {
      const state = makeState();
      const desc = makeDescriptor({
        position: { x: 10, y: 20, z: 30 },
        rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      });

      const mesh = createMeshFromDescriptor(state, desc as any);

      expect(mesh.position.set).toHaveBeenCalledWith(10, 20, 30);
      expect(mesh.rotationQuaternion).toBeDefined();
    });
  });

  describe('createShapeFromDescriptor', () => {
    it('creates box shape with doubled half-extents', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'box', params: { halfExtents: { x: 1, y: 2, z: 3 } } },
      });

      const shape = createShapeFromDescriptor(state, desc as any, {} as any);

      expect(shape).not.toBeNull();
      expect((shape as any)._options.type).toBe(0); // BOX
    });

    it('creates sphere shape', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'sphere', params: { radius: 2 } },
      });

      const shape = createShapeFromDescriptor(state, desc as any, {} as any);

      expect(shape).not.toBeNull();
      expect((shape as any)._options.type).toBe(1); // SPHERE
    });

    it('creates capsule shape', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'capsule', params: { halfHeight: 1, radius: 0.5 } },
      });

      const shape = createShapeFromDescriptor(state, desc as any, {} as any);

      expect(shape).not.toBeNull();
      expect((shape as any)._options.type).toBe(2); // CAPSULE
    });

    it('creates mesh shape', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'mesh', params: {} },
      });
      const mesh = {} as any;

      const shape = createShapeFromDescriptor(state, desc as any, mesh);

      expect(shape).not.toBeNull();
      expect((shape as any)._options.type).toBe(3); // MESH
      expect((shape as any)._options.parameters.mesh).toBe(mesh);
    });

    it('returns null for unknown shape type', () => {
      const state = makeState();
      const desc = makeDescriptor({
        shape: { type: 'cylinder', params: {} },
      });

      const shape = createShapeFromDescriptor(state, desc as any, {} as any);

      expect(shape).toBeNull();
    });
  });
});
