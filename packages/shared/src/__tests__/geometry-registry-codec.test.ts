import { describe, it, expect } from 'vitest';
import {
  OPCODE_GEOMETRY_DEF,
  OPCODE_MESH_REF,
  computeGeometryHash,
  encodeGeometryDef,
  decodeGeometryDef,
  encodeMeshRef,
  decodeMeshRef,
  readHashFromGeometryDef,
  readBodyIdFromMeshRef,
  readGeometryHashFromMeshRef,
  readMaterialHashFromMeshRef,
} from '../index.js';

// --- Test data helpers ---

function makeBox(): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  // Simplified box: 8 vertices, 12 triangles (36 indices)
  const positions = new Float32Array([
    -1, -1, -1,  1, -1, -1,  1, 1, -1,  -1, 1, -1,
    -1, -1, 1,   1, -1, 1,   1, 1, 1,   -1, 1, 1,
  ]);
  const normals = new Float32Array([
    0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1,
    0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2,  0, 2, 3,  // front
    4, 6, 5,  4, 7, 6,  // back
    0, 3, 7,  0, 7, 4,  // left
    1, 5, 6,  1, 6, 2,  // right
    3, 2, 6,  3, 6, 7,  // top
    0, 4, 5,  0, 5, 1,  // bottom
  ]);
  return { positions, normals, uvs, indices };
}

function makeSphere(): { positions: Float32Array; indices: Uint32Array } {
  // Minimal sphere: 4 vertices, 4 triangles
  const positions = new Float32Array([
    0, 1, 0,  1, -1, 0,  -1, -1, 0,  0, 0, 1,
  ]);
  const indices = new Uint32Array([0, 1, 2,  0, 1, 3,  0, 2, 3,  1, 2, 3]);
  return { positions, indices };
}

// --- Hash tests ---

describe('computeGeometryHash', () => {
  it('should return consistent hash for identical data', () => {
    const box1 = makeBox();
    const box2 = makeBox();
    const hash1 = computeGeometryHash(box1.positions, box1.normals, box1.uvs, undefined, box1.indices);
    const hash2 = computeGeometryHash(box2.positions, box2.normals, box2.uvs, undefined, box2.indices);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different geometry', () => {
    const box = makeBox();
    const sphere = makeSphere();
    const hashBox = computeGeometryHash(box.positions, box.normals, box.uvs, undefined, box.indices);
    const hashSphere = computeGeometryHash(sphere.positions, undefined, undefined, undefined, sphere.indices);
    expect(hashBox).not.toBe(hashSphere);
  });

  it('should produce different hashes when optional attributes differ', () => {
    const box = makeBox();
    const hashWithNormals = computeGeometryHash(box.positions, box.normals, undefined, undefined, box.indices);
    const hashWithoutNormals = computeGeometryHash(box.positions, undefined, undefined, undefined, box.indices);
    expect(hashWithNormals).not.toBe(hashWithoutNormals);
  });

  it('should match format "{vertexCount}-{indexCount}-{hex8}"', () => {
    const box = makeBox();
    const hash = computeGeometryHash(box.positions, box.normals, box.uvs, undefined, box.indices);
    const match = hash.match(/^(\d+)-(\d+)-([0-9a-f]{8})$/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(box.positions.length / 3); // vertexCount
    expect(Number(match![2])).toBe(box.indices.length); // indexCount
  });
});

// --- GEOMETRY_DEF encode/decode ---

describe('encodeGeometryDef / decodeGeometryDef', () => {
  it('should round-trip with all attributes', () => {
    const box = makeBox();
    const hash = computeGeometryHash(box.positions, box.normals, box.uvs, undefined, box.indices);
    const encoded = encodeGeometryDef(hash, box.positions, box.normals, box.uvs, undefined, box.indices);
    const decoded = decodeGeometryDef(encoded);

    expect(decoded.hash).toBe(hash);
    expect(decoded.positions).toEqual(box.positions);
    expect(decoded.normals).toEqual(box.normals);
    expect(decoded.uvs).toEqual(box.uvs);
    expect(decoded.colors).toBeUndefined();
    expect(decoded.indices).toEqual(box.indices);
  });

  it('should round-trip with positions and indices only', () => {
    const sphere = makeSphere();
    const hash = computeGeometryHash(sphere.positions, undefined, undefined, undefined, sphere.indices);
    const encoded = encodeGeometryDef(hash, sphere.positions, undefined, undefined, undefined, sphere.indices);
    const decoded = decodeGeometryDef(encoded);

    expect(decoded.hash).toBe(hash);
    expect(decoded.positions).toEqual(sphere.positions);
    expect(decoded.normals).toBeUndefined();
    expect(decoded.uvs).toBeUndefined();
    expect(decoded.colors).toBeUndefined();
    expect(decoded.indices).toEqual(sphere.indices);
  });

  it('should round-trip with vertex colors', () => {
    const box = makeBox();
    const colors = new Float32Array(8 * 4); // 8 vertices, RGBA
    for (let i = 0; i < colors.length; i++) colors[i] = i / colors.length;

    const hash = computeGeometryHash(box.positions, box.normals, box.uvs, colors, box.indices);
    const encoded = encodeGeometryDef(hash, box.positions, box.normals, box.uvs, colors, box.indices);
    const decoded = decodeGeometryDef(encoded);

    expect(decoded.colors).toEqual(colors);
  });

  it('should have correct opcode byte', () => {
    const sphere = makeSphere();
    const hash = computeGeometryHash(sphere.positions, undefined, undefined, undefined, sphere.indices);
    const encoded = encodeGeometryDef(hash, sphere.positions, undefined, undefined, undefined, sphere.indices);
    expect(encoded[0]).toBe(OPCODE_GEOMETRY_DEF);
    expect(encoded[0]).toBe(0x04);
  });
});

// --- MESH_REF encode/decode ---

describe('encodeMeshRef / decodeMeshRef', () => {
  it('should round-trip body ID, geometry hash, and material hash', () => {
    const bodyId = 'body-123';
    const geoHash = '8-36-abcd1234';
    const matHash = 'mat-deadbeef';

    const encoded = encodeMeshRef(bodyId, geoHash, matHash);
    const decoded = decodeMeshRef(encoded);

    expect(decoded.bodyId).toBe(bodyId);
    expect(decoded.geometryHash).toBe(geoHash);
    expect(decoded.materialHash).toBe(matHash);
  });

  it('should have correct opcode byte', () => {
    const encoded = encodeMeshRef('b', 'h', 'mat-00000000');
    expect(encoded[0]).toBe(OPCODE_MESH_REF);
    expect(encoded[0]).toBe(0x05);
  });

  it('should produce small messages', () => {
    const encoded = encodeMeshRef('body-abc', '8-36-deadbeef', 'mat-abcd1234');
    // opcode(1) + bodyIdLen(1) + bodyId(8) + hashLen(1) + hash(14) + matHashLen(1) + matHash(12) = 38
    expect(encoded.byteLength).toBeLessThan(50);
  });
});

// --- Fast header readers ---

describe('readHashFromGeometryDef', () => {
  it('should read hash without full decode', () => {
    const sphere = makeSphere();
    const hash = computeGeometryHash(sphere.positions, undefined, undefined, undefined, sphere.indices);
    const encoded = encodeGeometryDef(hash, sphere.positions, undefined, undefined, undefined, sphere.indices);

    const fastHash = readHashFromGeometryDef(encoded);
    expect(fastHash).toBe(hash);
  });
});

describe('readBodyIdFromMeshRef', () => {
  it('should read bodyId without full decode', () => {
    const encoded = encodeMeshRef('my-body-42', '4-12-aabbccdd', 'mat-11223344');
    const bodyId = readBodyIdFromMeshRef(encoded);
    expect(bodyId).toBe('my-body-42');
  });
});

describe('readGeometryHashFromMeshRef', () => {
  it('should read geometry hash without full decode', () => {
    const encoded = encodeMeshRef('body-x', '8-36-12345678', 'mat-aabbccdd');
    const geoHash = readGeometryHashFromMeshRef(encoded);
    expect(geoHash).toBe('8-36-12345678');
  });
});

describe('readMaterialHashFromMeshRef', () => {
  it('should read material hash without full decode', () => {
    const encoded = encodeMeshRef('body-x', '8-36-12345678', 'mat-aabbccdd');
    const matHash = readMaterialHashFromMeshRef(encoded);
    expect(matHash).toBe('mat-aabbccdd');
  });
});
