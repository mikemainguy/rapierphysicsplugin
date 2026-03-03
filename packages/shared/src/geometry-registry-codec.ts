/**
 * Geometry Registry wire format — content-hash deduplication for mesh geometry.
 *
 * GEOMETRY_DEF (0x04) — sent once per unique geometry:
 *   [opcode: u8 = 0x04]
 *   [hashLength: u8] [hash: utf8]
 *   [flags: u8] [vertexCount: u32 LE] [indexCount: u32 LE]
 *   [positions: Float32Array]   -- vertexCount × 3 floats (always)
 *   [normals: Float32Array]     -- vertexCount × 3 floats (if flag bit 0)
 *   [uvs: Float32Array]         -- vertexCount × 2 floats (if flag bit 1)
 *   [colors: Float32Array]      -- vertexCount × 4 floats (if flag bit 2)
 *   [indices: Uint32Array]      -- indexCount uint32s
 *
 * MESH_REF (0x05) — sent per body (~small):
 *   [opcode: u8 = 0x05]
 *   [bodyIdLength: u8] [bodyId: utf8]
 *   [hashLength: u8] [geometryHash: utf8]
 *   [materialHashLength: u8] [materialHash: utf8]
 */

export const OPCODE_GEOMETRY_DEF = 0x04;
export const OPCODE_MESH_REF = 0x05;

const FLAG_HAS_NORMALS = 0x01;
const FLAG_HAS_UVS = 0x02;
const FLAG_HAS_COLORS = 0x04;

export interface GeometryDefData {
  hash: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices: Uint32Array;
}

export interface MeshRefData {
  bodyId: string;
  geometryHash: string;
  materialHash: string;
}

// --- FNV-1a 32-bit hash ---

function fnv1a32(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compute a content hash over all vertex attribute bytes + index bytes.
 * Format: "{vertexCount}-{indexCount}-{hex8}"
 */
export function computeGeometryHash(
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array | undefined,
  colors: Float32Array | undefined,
  indices: Uint32Array,
): string {
  const vertexCount = positions.length / 3;
  const indexCount = indices.length;

  // Compute total byte length for all attribute arrays
  let totalBytes = positions.byteLength + indices.byteLength;
  if (normals) totalBytes += normals.byteLength;
  if (uvs) totalBytes += uvs.byteLength;
  if (colors) totalBytes += colors.byteLength;

  // Concatenate all attribute bytes into a single buffer for hashing
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  combined.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), offset);
  offset += positions.byteLength;

  if (normals) {
    combined.set(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength), offset);
    offset += normals.byteLength;
  }
  if (uvs) {
    combined.set(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength), offset);
    offset += uvs.byteLength;
  }
  if (colors) {
    combined.set(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength), offset);
    offset += colors.byteLength;
  }

  combined.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), offset);

  const hash = fnv1a32(combined);
  const hex = hash.toString(16).padStart(8, '0');
  return `${vertexCount}-${indexCount}-${hex}`;
}

// --- GEOMETRY_DEF encode/decode ---

export function encodeGeometryDef(
  hash: string,
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array | undefined,
  colors: Float32Array | undefined,
  indices: Uint32Array,
): Uint8Array {
  const encoder = new TextEncoder();
  const hashBytes = encoder.encode(hash);
  const vertexCount = positions.length / 3;

  let flags = 0;
  if (normals) flags |= FLAG_HAS_NORMALS;
  if (uvs) flags |= FLAG_HAS_UVS;
  if (colors) flags |= FLAG_HAS_COLORS;

  // Total size: opcode(1) + hashLen(1) + hash + flags(1) + vertexCount(4) + indexCount(4)
  //   + positions + normals? + uvs? + colors? + indices
  let totalSize = 1 + 1 + hashBytes.length + 1 + 4 + 4;
  totalSize += positions.byteLength;
  if (normals) totalSize += normals.byteLength;
  if (uvs) totalSize += uvs.byteLength;
  if (colors) totalSize += colors.byteLength;
  totalSize += indices.byteLength;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  // Header
  view.setUint8(offset, OPCODE_GEOMETRY_DEF); offset += 1;
  view.setUint8(offset, hashBytes.length); offset += 1;
  arr.set(hashBytes, offset); offset += hashBytes.length;
  view.setUint8(offset, flags); offset += 1;
  view.setUint32(offset, vertexCount, true); offset += 4;
  view.setUint32(offset, indices.length, true); offset += 4;

  // Positions
  arr.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), offset);
  offset += positions.byteLength;

  // Normals
  if (normals) {
    arr.set(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength), offset);
    offset += normals.byteLength;
  }

  // UVs
  if (uvs) {
    arr.set(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength), offset);
    offset += uvs.byteLength;
  }

  // Vertex colors
  if (colors) {
    arr.set(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength), offset);
    offset += colors.byteLength;
  }

  // Indices
  arr.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), offset);

  return arr;
}

export function decodeGeometryDef(data: Uint8Array): GeometryDefData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const hashLength = view.getUint8(offset); offset += 1;
  const hash = decoder.decode(data.subarray(offset, offset + hashLength));
  offset += hashLength;

  const flags = view.getUint8(offset); offset += 1;
  const vertexCount = view.getUint32(offset, true); offset += 4;
  const indexCount = view.getUint32(offset, true); offset += 4;

  // Positions
  const posBytes = vertexCount * 3 * 4;
  const positions = new Float32Array(data.slice(offset, offset + posBytes).buffer);
  offset += posBytes;

  // Normals
  let normals: Float32Array | undefined;
  if (flags & FLAG_HAS_NORMALS) {
    const nBytes = vertexCount * 3 * 4;
    normals = new Float32Array(data.slice(offset, offset + nBytes).buffer);
    offset += nBytes;
  }

  // UVs
  let uvs: Float32Array | undefined;
  if (flags & FLAG_HAS_UVS) {
    const uBytes = vertexCount * 2 * 4;
    uvs = new Float32Array(data.slice(offset, offset + uBytes).buffer);
    offset += uBytes;
  }

  // Vertex colors
  let colors: Float32Array | undefined;
  if (flags & FLAG_HAS_COLORS) {
    const cBytes = vertexCount * 4 * 4;
    colors = new Float32Array(data.slice(offset, offset + cBytes).buffer);
    offset += cBytes;
  }

  // Indices
  const idxBytes = indexCount * 4;
  const indices = new Uint32Array(data.slice(offset, offset + idxBytes).buffer);

  return { hash, positions, normals, uvs, colors, indices };
}

// --- MESH_REF encode/decode ---

export function encodeMeshRef(
  bodyId: string,
  geometryHash: string,
  materialHash: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const bodyIdBytes = encoder.encode(bodyId);
  const hashBytes = encoder.encode(geometryHash);
  const matHashBytes = encoder.encode(materialHash);

  // opcode(1) + bodyIdLen(1) + bodyId + hashLen(1) + hash + matHashLen(1) + matHash
  const totalSize = 1 + 1 + bodyIdBytes.length + 1 + hashBytes.length + 1 + matHashBytes.length;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  view.setUint8(offset, OPCODE_MESH_REF); offset += 1;
  view.setUint8(offset, bodyIdBytes.length); offset += 1;
  arr.set(bodyIdBytes, offset); offset += bodyIdBytes.length;
  view.setUint8(offset, hashBytes.length); offset += 1;
  arr.set(hashBytes, offset); offset += hashBytes.length;
  view.setUint8(offset, matHashBytes.length); offset += 1;
  arr.set(matHashBytes, offset); offset += matHashBytes.length;

  return arr;
}

export function decodeMeshRef(data: Uint8Array): MeshRefData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const bodyIdLength = view.getUint8(offset); offset += 1;
  const bodyId = decoder.decode(data.subarray(offset, offset + bodyIdLength));
  offset += bodyIdLength;

  const hashLength = view.getUint8(offset); offset += 1;
  const geometryHash = decoder.decode(data.subarray(offset, offset + hashLength));
  offset += hashLength;

  const matHashLength = view.getUint8(offset); offset += 1;
  const materialHash = decoder.decode(data.subarray(offset, offset + matHashLength));

  return {
    bodyId,
    geometryHash,
    materialHash,
  };
}

// --- Fast header readers (for server routing without full decode) ---

/** Read just the hash from a GEOMETRY_DEF header. */
export function readHashFromGeometryDef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const hashLength = data[1];
  return decoder.decode(data.subarray(2, 2 + hashLength));
}

/** Read just the bodyId from a MESH_REF header. */
export function readBodyIdFromMeshRef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const bodyIdLength = data[1];
  return decoder.decode(data.subarray(2, 2 + bodyIdLength));
}

/** Read just the geometry hash from a MESH_REF header. */
export function readGeometryHashFromMeshRef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const bodyIdLength = data[1];
  const hashOffset = 2 + bodyIdLength;
  const hashLength = data[hashOffset];
  return decoder.decode(data.subarray(hashOffset + 1, hashOffset + 1 + hashLength));
}

/** Read just the material hash from a MESH_REF header (skip bodyId + geoHash). */
export function readMaterialHashFromMeshRef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const bodyIdLength = data[1];
  const geoHashOffset = 2 + bodyIdLength;
  const geoHashLength = data[geoHashOffset];
  const matHashOffset = geoHashOffset + 1 + geoHashLength;
  const matHashLength = data[matHashOffset];
  return decoder.decode(data.subarray(matHashOffset + 1, matHashOffset + 1 + matHashLength));
}
