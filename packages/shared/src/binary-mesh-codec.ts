/**
 * Binary wire format for mesh geometry data.
 *
 * Layout:
 *   [opcode: u8 = 0x03]
 *   [bodyIdLength: u8]
 *   [bodyId: utf8 bytes]
 *   [flags: u8]           -- bit 0: has normals, bit 1: has UVs, bit 2: has vertex colors
 *   [vertexCount: u32 LE]
 *   [indexCount: u32 LE]
 *   [positions: Float32Array]   -- vertexCount x 3 floats (always)
 *   [normals: Float32Array]     -- vertexCount x 3 floats (if flag bit 0)
 *   [uvs: Float32Array]         -- vertexCount x 2 floats (if flag bit 1)
 *   [colors: Float32Array]      -- vertexCount x 4 floats (if flag bit 2)
 *   [indices: Uint32Array]      -- indexCount uint32s
 *   [diffuseR: f32, diffuseG: f32, diffuseB: f32]  -- 12 bytes, always
 *   [specularR: f32, specularG: f32, specularB: f32] -- 12 bytes, always
 */

export const OPCODE_MESH_BINARY = 0x03;

const FLAG_HAS_NORMALS = 0x01;
const FLAG_HAS_UVS = 0x02;
const FLAG_HAS_COLORS = 0x04;

export interface MeshBinaryData {
  bodyId: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices: Uint32Array;
  diffuseColor?: { r: number; g: number; b: number };
  specularColor?: { r: number; g: number; b: number };
}

export function encodeMeshBinary(
  bodyId: string,
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array | undefined,
  colors: Float32Array | undefined,
  indices: Uint32Array,
  diffuseColor?: { r: number; g: number; b: number },
  specularColor?: { r: number; g: number; b: number },
): Uint8Array {
  const encoder = new TextEncoder();
  const bodyIdBytes = encoder.encode(bodyId);
  const vertexCount = positions.length / 3;

  let flags = 0;
  if (normals) flags |= FLAG_HAS_NORMALS;
  if (uvs) flags |= FLAG_HAS_UVS;
  if (colors) flags |= FLAG_HAS_COLORS;

  // Calculate total size
  let totalSize = 1 + 1 + bodyIdBytes.length + 1 + 4 + 4; // opcode + idLen + id + flags + vertexCount + indexCount
  totalSize += positions.byteLength;                         // positions always present
  if (normals) totalSize += normals.byteLength;
  if (uvs) totalSize += uvs.byteLength;
  if (colors) totalSize += colors.byteLength;
  totalSize += indices.byteLength;
  totalSize += 12 + 12; // diffuse + specular (3 floats each)

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  // Header
  view.setUint8(offset, OPCODE_MESH_BINARY); offset += 1;
  view.setUint8(offset, bodyIdBytes.length); offset += 1;
  arr.set(bodyIdBytes, offset); offset += bodyIdBytes.length;
  view.setUint8(offset, flags); offset += 1;
  view.setUint32(offset, vertexCount, true); offset += 4;
  view.setUint32(offset, indices.length, true); offset += 4;

  // Positions (always)
  arr.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), offset);
  offset += positions.byteLength;

  // Normals (if flag)
  if (normals) {
    arr.set(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength), offset);
    offset += normals.byteLength;
  }

  // UVs (if flag)
  if (uvs) {
    arr.set(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength), offset);
    offset += uvs.byteLength;
  }

  // Vertex colors (if flag)
  if (colors) {
    arr.set(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength), offset);
    offset += colors.byteLength;
  }

  // Indices
  arr.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), offset);
  offset += indices.byteLength;

  // Diffuse color
  const dc = diffuseColor ?? { r: 0.5, g: 0.5, b: 0.5 };
  view.setFloat32(offset, dc.r, true); offset += 4;
  view.setFloat32(offset, dc.g, true); offset += 4;
  view.setFloat32(offset, dc.b, true); offset += 4;

  // Specular color
  const sc = specularColor ?? { r: 0.3, g: 0.3, b: 0.3 };
  view.setFloat32(offset, sc.r, true); offset += 4;
  view.setFloat32(offset, sc.g, true); offset += 4;
  view.setFloat32(offset, sc.b, true); offset += 4;

  return arr;
}

export function decodeMeshBinary(data: Uint8Array): MeshBinaryData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const bodyIdLength = view.getUint8(offset); offset += 1;
  const bodyId = decoder.decode(data.subarray(offset, offset + bodyIdLength));
  offset += bodyIdLength;

  const flags = view.getUint8(offset); offset += 1;
  const vertexCount = view.getUint32(offset, true); offset += 4;
  const indexCount = view.getUint32(offset, true); offset += 4;

  // Copy into new typed arrays to avoid alignment issues (offset after
  // the variable-length bodyId is not guaranteed to be 4-byte aligned).

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
  offset += idxBytes;

  // Diffuse color
  const diffuseR = view.getFloat32(offset, true); offset += 4;
  const diffuseG = view.getFloat32(offset, true); offset += 4;
  const diffuseB = view.getFloat32(offset, true); offset += 4;

  // Specular color
  const specularR = view.getFloat32(offset, true); offset += 4;
  const specularG = view.getFloat32(offset, true); offset += 4;
  const specularB = view.getFloat32(offset, true); offset += 4;

  return {
    bodyId,
    positions,
    normals,
    uvs,
    colors,
    indices,
    diffuseColor: { r: diffuseR, g: diffuseG, b: diffuseB },
    specularColor: { r: specularR, g: specularG, b: specularB },
  };
}

/** Read just the bodyId from a mesh binary header without full decode (for server routing). */
export function readBodyIdFromMeshBinary(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const bodyIdLength = data[1];
  return decoder.decode(data.subarray(2, 2 + bodyIdLength));
}
