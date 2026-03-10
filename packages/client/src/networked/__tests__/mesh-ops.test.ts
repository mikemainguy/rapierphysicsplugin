import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NetworkedPluginState } from '../types.js';
import {
  sendMeshBinaryForBody,
  extractAndSendTexture,
  handleGeometryDefReceived,
  handleMeshRefReceived,
  handleMaterialDefReceived,
  handleTextureDefReceived,
  createTextureFromCache,
} from '../mesh-ops.js';

// --- Mocks for @babylonjs/core ---

vi.mock('@babylonjs/core', () => {
  class VertexData {
    positions: any; normals: any; uvs: any; colors: any; indices: any;
    applyToMesh = vi.fn();
  }
  class StandardMaterial {
    name: string;
    diffuseColor: any = { r: 0.5, g: 0.5, b: 0.5 };
    specularColor: any = { r: 0.3, g: 0.3, b: 0.3 };
    emissiveColor: any = { r: 0, g: 0, b: 0 };
    ambientColor: any = { r: 0, g: 0, b: 0 };
    alpha = 1;
    specularPower = 64;
    diffuseTexture: any = null;
    bumpTexture: any = null;
    specularTexture: any = null;
    emissiveTexture: any = null;
    dispose = vi.fn();
    constructor(name: string, _scene: any) { this.name = name; }
  }
  class Color3 {
    constructor(public r = 0, public g = 0, public b = 0) {}
  }
  class Texture {
    constructor(public url: string, public scene: any) {}
  }
  class Mesh {}
  return { VertexData, StandardMaterial, Color3, Texture, Mesh };
});

// --- Mocks for @rapierphysicsplugin/shared ---

vi.mock('@rapierphysicsplugin/shared', () => ({
  computeGeometryHash: vi.fn(() => 'geom-hash-1'),
  encodeGeometryDef: vi.fn(() => new Uint8Array([1])),
  encodeMeshRef: vi.fn(() => new Uint8Array([2])),
  computeMaterialHash: vi.fn(() => 'mat-hash-1'),
  encodeMaterialDef: vi.fn(() => new Uint8Array([3])),
  computeTextureHash: vi.fn(() => 'tex-hash-1'),
  encodeTextureDef: vi.fn(() => new Uint8Array([4])),
}));

import {
  computeGeometryHash,
  encodeGeometryDef,
  encodeMeshRef,
  computeMaterialHash,
  encodeMaterialDef,
  computeTextureHash,
  encodeTextureDef,
} from '@rapierphysicsplugin/shared';

// --- Helpers ---

function makeState(overrides: Partial<NetworkedPluginState> = {}): NetworkedPluginState {
  return {
    syncClient: {
      sendGeometryDef: vi.fn(),
      sendMeshRef: vi.fn(),
      sendMaterialDef: vi.fn(),
      sendTextureDef: vi.fn(),
    } as any,
    scene: { name: 'mock-scene' } as any,
    bodyToId: new Map(),
    idToBody: new Map(),
    geometryCache: new Map(),
    sentGeometryHashes: new Set(),
    materialCache: new Map(),
    textureCache: new Map(),
    sentMaterialHashes: new Set(),
    sentTextureHashes: new Set(),
    textureObjectUrls: new Map(),
    ...overrides,
  } as any;
}

function makeMockMesh(opts: {
  positions?: number[];
  indices?: number[];
  normals?: number[] | null;
  uvs?: number[] | null;
  colors?: number[] | null;
  material?: any;
} = {}) {
  const { positions = [0, 1, 2], indices = [0, 1, 2], normals = null, uvs = null, colors = null, material = null } = opts;
  return {
    geometry: true,
    getVerticesData: vi.fn((kind: string) => {
      if (kind === 'position') return positions;
      if (kind === 'normal') return normals;
      if (kind === 'uv') return uvs;
      if (kind === 'color') return colors;
      return null;
    }),
    getIndices: vi.fn(() => indices),
    material,
  };
}

function makeMockBody(mesh: any) {
  return { transformNode: mesh } as any;
}

// --- Tests ---

describe('mesh-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMeshBinaryForBody', () => {
    it('sends geometry, material, and mesh ref for a body with mesh', () => {
      const mesh = makeMockMesh();
      const body = makeMockBody(mesh);
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(computeGeometryHash).toHaveBeenCalled();
      expect(encodeGeometryDef).toHaveBeenCalled();
      expect(state.syncClient.sendGeometryDef).toHaveBeenCalled();
      expect(state.sentGeometryHashes.has('geom-hash-1')).toBe(true);
      expect(computeMaterialHash).toHaveBeenCalled();
      expect(encodeMaterialDef).toHaveBeenCalled();
      expect(state.syncClient.sendMaterialDef).toHaveBeenCalled();
      expect(state.sentMaterialHashes.has('mat-hash-1')).toBe(true);
      expect(encodeMeshRef).toHaveBeenCalledWith('body-1', 'geom-hash-1', 'mat-hash-1');
      expect(state.syncClient.sendMeshRef).toHaveBeenCalled();
    });

    it('skips if transformNode has no geometry', () => {
      const body = { transformNode: {} } as any;
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(state.syncClient.sendMeshRef).not.toHaveBeenCalled();
    });

    it('skips if no transformNode', () => {
      const body = { transformNode: null } as any;
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(state.syncClient.sendMeshRef).not.toHaveBeenCalled();
    });

    it('skips if positions or indices are null', () => {
      const mesh = {
        geometry: true,
        getVerticesData: vi.fn(() => null),
        getIndices: vi.fn(() => null),
        material: null,
      };
      const body = makeMockBody(mesh);
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(state.syncClient.sendMeshRef).not.toHaveBeenCalled();
    });

    it('does not re-send geometry if hash already sent', () => {
      const mesh = makeMockMesh();
      const body = makeMockBody(mesh);
      const state = makeState();
      state.sentGeometryHashes.add('geom-hash-1');

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(state.syncClient.sendGeometryDef).not.toHaveBeenCalled();
      // Still sends mesh ref
      expect(state.syncClient.sendMeshRef).toHaveBeenCalled();
    });

    it('does not re-send material if hash already sent', () => {
      const mesh = makeMockMesh();
      const body = makeMockBody(mesh);
      const state = makeState();
      state.sentMaterialHashes.add('mat-hash-1');

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(state.syncClient.sendMaterialDef).not.toHaveBeenCalled();
      expect(state.syncClient.sendMeshRef).toHaveBeenCalled();
    });

    it('extracts material properties when material is present', () => {
      const mat = {
        diffuseColor: { r: 1, g: 0, b: 0 },
        specularColor: { r: 0.5, g: 0.5, b: 0.5 },
        emissiveColor: { r: 0.1, g: 0.1, b: 0.1 },
        ambientColor: { r: 0.2, g: 0.2, b: 0.2 },
        alpha: 0.8,
        specularPower: 32,
        diffuseTexture: null,
        bumpTexture: null,
        specularTexture: null,
        emissiveTexture: null,
      };
      const mesh = makeMockMesh({ material: mat });
      const body = makeMockBody(mesh);
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(computeMaterialHash).toHaveBeenCalledWith(
        { r: 1, g: 0, b: 0 },
        { r: 0.5, g: 0.5, b: 0.5 },
        { r: 0.1, g: 0.1, b: 0.1 },
        { r: 0.2, g: 0.2, b: 0.2 },
        0.8, 32,
        undefined, undefined, undefined, undefined,
      );
    });

    it('extracts and sends textures from material', () => {
      const mat = {
        diffuseColor: { r: 1, g: 0, b: 0 },
        specularColor: { r: 0, g: 0, b: 0 },
        emissiveColor: { r: 0, g: 0, b: 0 },
        ambientColor: { r: 0, g: 0, b: 0 },
        alpha: 1,
        specularPower: 64,
        diffuseTexture: { _buffer: new ArrayBuffer(4) },
        bumpTexture: { _buffer: new ArrayBuffer(4) },
        specularTexture: null,
        emissiveTexture: null,
      };
      const mesh = makeMockMesh({ material: mat });
      const body = makeMockBody(mesh);
      const state = makeState();

      sendMeshBinaryForBody(state, body, 'body-1');

      expect(computeTextureHash).toHaveBeenCalledTimes(2);
      // Both textures produce the same hash ('tex-hash-1'), so only the first is sent
      expect(state.syncClient.sendTextureDef).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractAndSendTexture', () => {
    it('returns hash and sends texture when buffer exists', () => {
      const state = makeState();
      const texture = { _buffer: new ArrayBuffer(8) } as any;

      const result = extractAndSendTexture(state, texture);

      expect(result).toBe('tex-hash-1');
      expect(state.syncClient.sendTextureDef).toHaveBeenCalled();
      expect(state.sentTextureHashes.has('tex-hash-1')).toBe(true);
      expect(state.textureCache.has('tex-hash-1')).toBe(true);
    });

    it('returns undefined when buffer is null', () => {
      const state = makeState();
      const texture = { _buffer: null } as any;

      const result = extractAndSendTexture(state, texture);

      expect(result).toBeUndefined();
    });

    it('does not re-send if hash already sent', () => {
      const state = makeState();
      state.sentTextureHashes.add('tex-hash-1');
      const texture = { _buffer: new ArrayBuffer(4) } as any;

      const result = extractAndSendTexture(state, texture);

      expect(result).toBe('tex-hash-1');
      expect(state.syncClient.sendTextureDef).not.toHaveBeenCalled();
    });

    it('returns undefined on error', () => {
      const state = makeState();
      // texture without _buffer property at all
      const texture = {} as any;

      const result = extractAndSendTexture(state, texture);

      expect(result).toBeUndefined();
    });
  });

  describe('handleGeometryDefReceived', () => {
    it('caches geometry and marks hash as sent', () => {
      const state = makeState();
      const data = { hash: 'g1', positions: new Float32Array([1]), indices: new Uint32Array([0]) } as any;

      handleGeometryDefReceived(state, data);

      expect(state.geometryCache.get('g1')).toBe(data);
      expect(state.sentGeometryHashes.has('g1')).toBe(true);
    });
  });

  describe('handleMaterialDefReceived', () => {
    it('caches material and marks hash as sent', () => {
      const state = makeState();
      const data = { hash: 'm1', diffuseColor: { r: 1, g: 0, b: 0 } } as any;

      handleMaterialDefReceived(state, data);

      expect(state.materialCache.get('m1')).toBe(data);
      expect(state.sentMaterialHashes.has('m1')).toBe(true);
    });
  });

  describe('handleTextureDefReceived', () => {
    it('caches texture and marks hash as sent', () => {
      const state = makeState();
      const data = { hash: 't1', imageData: new Uint8Array([1, 2]) } as any;

      handleTextureDefReceived(state, data);

      expect(state.textureCache.get('t1')).toBe(data);
      expect(state.sentTextureHashes.has('t1')).toBe(true);
    });
  });

  describe('handleMeshRefReceived', () => {
    it('returns early if body not found', () => {
      const state = makeState();
      handleMeshRefReceived(state, { bodyId: 'x', geometryHash: 'g1', materialHash: 'm1' } as any);
      // no error thrown
    });

    it('returns early if scene is null', () => {
      const state = makeState({ scene: null });
      const body = makeMockBody({ geometry: true });
      state.idToBody.set('b1', body);
      handleMeshRefReceived(state, { bodyId: 'b1', geometryHash: 'g1', materialHash: 'm1' } as any);
    });

    it('returns early if geometry not cached', () => {
      const mesh = makeMockMesh();
      const body = makeMockBody(mesh);
      const state = makeState();
      state.idToBody.set('b1', body);

      handleMeshRefReceived(state, { bodyId: 'b1', geometryHash: 'missing', materialHash: 'm1' } as any);
      // no crash
    });

    it('applies geometry and default material when matDef not found', () => {
      const mockMesh = { geometry: true, material: null as any };
      const body = makeMockBody(mockMesh);
      const state = makeState();
      state.idToBody.set('b1', body);
      state.geometryCache.set('g1', {
        hash: 'g1',
        positions: new Float32Array([0, 1, 2]),
        indices: new Uint32Array([0, 1, 2]),
      } as any);

      handleMeshRefReceived(state, { bodyId: 'b1', geometryHash: 'g1', materialHash: 'missing' } as any);

      expect(mockMesh.material).not.toBeNull();
      expect(mockMesh.material.diffuseColor.r).toBe(0.5);
    });

    it('applies material def properties when found', () => {
      const mockMesh = { geometry: true, material: null as any };
      const body = makeMockBody(mockMesh);
      const state = makeState();
      state.idToBody.set('b1', body);
      state.geometryCache.set('g1', {
        hash: 'g1',
        positions: new Float32Array([0, 1, 2]),
        indices: new Uint32Array([0, 1, 2]),
      } as any);
      state.materialCache.set('m1', {
        hash: 'm1',
        diffuseColor: { r: 1, g: 0, b: 0 },
        specularColor: { r: 0, g: 1, b: 0 },
        emissiveColor: { r: 0, g: 0, b: 1 },
        ambientColor: { r: 0.1, g: 0.1, b: 0.1 },
        alpha: 0.5,
        specularPower: 32,
      } as any);

      handleMeshRefReceived(state, { bodyId: 'b1', geometryHash: 'g1', materialHash: 'm1' } as any);

      const mat = mockMesh.material;
      expect(mat.diffuseColor.r).toBe(1);
      expect(mat.alpha).toBe(0.5);
      expect(mat.specularPower).toBe(32);
    });

    it('disposes old material', () => {
      const oldMat = { dispose: vi.fn() };
      const mockMesh = { geometry: true, material: oldMat };
      const body = makeMockBody(mockMesh);
      const state = makeState();
      state.idToBody.set('b1', body);
      state.geometryCache.set('g1', {
        hash: 'g1',
        positions: new Float32Array([0, 1, 2]),
        indices: new Uint32Array([0, 1, 2]),
      } as any);

      handleMeshRefReceived(state, { bodyId: 'b1', geometryHash: 'g1', materialHash: 'm1' } as any);

      expect(oldMat.dispose).toHaveBeenCalled();
    });
  });

  describe('createTextureFromCache', () => {
    it('returns null if texture not cached', () => {
      const state = makeState();
      const result = createTextureFromCache(state, 'nope', state.scene as any);
      expect(result).toBeNull();
    });

    it('creates texture from cached data', () => {
      const state = makeState();
      state.textureCache.set('t1', { hash: 't1', imageData: new Uint8Array([1, 2, 3]) } as any);

      // Mock URL.createObjectURL
      const origCreateObjectURL = globalThis.URL.createObjectURL;
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

      try {
        const result = createTextureFromCache(state, 't1', state.scene as any);
        expect(result).not.toBeNull();
        expect(state.textureObjectUrls.get('t1')).toBe('blob:mock-url');
      } finally {
        globalThis.URL.createObjectURL = origCreateObjectURL;
      }
    });

    it('reuses existing object URL', () => {
      const state = makeState();
      state.textureCache.set('t1', { hash: 't1', imageData: new Uint8Array([1]) } as any);
      state.textureObjectUrls.set('t1', 'blob:existing');

      const createObjectURL = vi.fn();
      const orig = globalThis.URL.createObjectURL;
      globalThis.URL.createObjectURL = createObjectURL;

      try {
        const result = createTextureFromCache(state, 't1', state.scene as any);
        expect(result).not.toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();
      } finally {
        globalThis.URL.createObjectURL = orig;
      }
    });
  });
});
