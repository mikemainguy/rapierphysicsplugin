/**
 * Material & Texture Registry wire format — content-hash deduplication.
 *
 * TEXTURE_DEF (0x07) — sent once per unique texture:
 *   [opcode: u8 = 0x07]
 *   [hashLength: u8] [hash: utf8]
 *   [dataLength: u32 LE]
 *   [imageData: raw bytes (PNG/JPG)]
 *
 * MATERIAL_DEF (0x06) — sent once per unique material:
 *   [opcode: u8 = 0x06]
 *   [hashLength: u8] [hash: utf8]
 *   [diffuseRGB: 3×f32] [specularRGB: 3×f32] [emissiveRGB: 3×f32] [ambientRGB: 3×f32]
 *   [alpha: f32] [specularPower: f32]
 *   [textureFlags: u8]
 *     bit 0: diffuseTexture   → [hashLen: u8] [hash: utf8]
 *     bit 1: normalTexture    → [hashLen: u8] [hash: utf8]
 *     bit 2: specularTexture  → [hashLen: u8] [hash: utf8]
 *     bit 3: emissiveTexture  → [hashLen: u8] [hash: utf8]
 */

export const OPCODE_MATERIAL_DEF = 0x06;
export const OPCODE_TEXTURE_DEF = 0x07;

export interface TextureDefData {
  hash: string;
  imageData: Uint8Array;
}

export interface MaterialDefData {
  hash: string;
  diffuseColor: { r: number; g: number; b: number };
  specularColor: { r: number; g: number; b: number };
  emissiveColor: { r: number; g: number; b: number };
  ambientColor: { r: number; g: number; b: number };
  alpha: number;
  specularPower: number;
  diffuseTextureHash?: string;
  normalTextureHash?: string;
  specularTextureHash?: string;
  emissiveTextureHash?: string;
}

// --- FNV-1a 32-bit hash (self-contained, matches geometry-registry-codec pattern) ---

function fnv1a32(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compute a content hash for texture image data.
 * Format: "tex-{dataLength}-{hex8}"
 */
export function computeTextureHash(imageData: Uint8Array): string {
  const hash = fnv1a32(imageData);
  const hex = hash.toString(16).padStart(8, '0');
  return `tex-${imageData.byteLength}-${hex}`;
}

/**
 * Compute a content hash for material properties.
 * FNV-1a over 56 bytes of color/scalar data + texture hash strings.
 * Format: "mat-{hex8}"
 */
export function computeMaterialHash(
  diffuse: { r: number; g: number; b: number },
  specular: { r: number; g: number; b: number },
  emissive: { r: number; g: number; b: number },
  ambient: { r: number; g: number; b: number },
  alpha: number,
  specularPower: number,
  diffuseTextureHash?: string,
  normalTextureHash?: string,
  specularTextureHash?: string,
  emissiveTextureHash?: string,
): string {
  // 4 colors × 3 floats × 4 bytes + 2 scalars × 4 bytes = 56 bytes
  const colorBuf = new ArrayBuffer(56);
  const colorView = new DataView(colorBuf);
  let off = 0;

  colorView.setFloat32(off, diffuse.r, true); off += 4;
  colorView.setFloat32(off, diffuse.g, true); off += 4;
  colorView.setFloat32(off, diffuse.b, true); off += 4;
  colorView.setFloat32(off, specular.r, true); off += 4;
  colorView.setFloat32(off, specular.g, true); off += 4;
  colorView.setFloat32(off, specular.b, true); off += 4;
  colorView.setFloat32(off, emissive.r, true); off += 4;
  colorView.setFloat32(off, emissive.g, true); off += 4;
  colorView.setFloat32(off, emissive.b, true); off += 4;
  colorView.setFloat32(off, ambient.r, true); off += 4;
  colorView.setFloat32(off, ambient.g, true); off += 4;
  colorView.setFloat32(off, ambient.b, true); off += 4;
  colorView.setFloat32(off, alpha, true); off += 4;
  colorView.setFloat32(off, specularPower, true);

  const encoder = new TextEncoder();
  const texParts: Uint8Array[] = [];
  if (diffuseTextureHash) texParts.push(encoder.encode(diffuseTextureHash));
  if (normalTextureHash) texParts.push(encoder.encode(normalTextureHash));
  if (specularTextureHash) texParts.push(encoder.encode(specularTextureHash));
  if (emissiveTextureHash) texParts.push(encoder.encode(emissiveTextureHash));

  let totalLen = 56;
  for (const p of texParts) totalLen += p.byteLength;

  const combined = new Uint8Array(totalLen);
  combined.set(new Uint8Array(colorBuf), 0);
  let pos = 56;
  for (const p of texParts) {
    combined.set(p, pos);
    pos += p.byteLength;
  }

  const hash = fnv1a32(combined);
  const hex = hash.toString(16).padStart(8, '0');
  return `mat-${hex}`;
}

// --- TEXTURE_DEF encode/decode ---

export function encodeTextureDef(hash: string, imageData: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const hashBytes = encoder.encode(hash);

  // opcode(1) + hashLen(1) + hash + dataLength(4) + imageData
  const totalSize = 1 + 1 + hashBytes.length + 4 + imageData.byteLength;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  view.setUint8(offset, OPCODE_TEXTURE_DEF); offset += 1;
  view.setUint8(offset, hashBytes.length); offset += 1;
  arr.set(hashBytes, offset); offset += hashBytes.length;
  view.setUint32(offset, imageData.byteLength, true); offset += 4;
  arr.set(imageData, offset);

  return arr;
}

export function decodeTextureDef(data: Uint8Array): TextureDefData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const hashLength = view.getUint8(offset); offset += 1;
  const hash = decoder.decode(data.subarray(offset, offset + hashLength));
  offset += hashLength;

  const dataLength = view.getUint32(offset, true); offset += 4;
  const imageData = data.slice(offset, offset + dataLength);

  return { hash, imageData };
}

/** Read just the hash from a TEXTURE_DEF header. */
export function readHashFromTextureDef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const hashLength = data[1];
  return decoder.decode(data.subarray(2, 2 + hashLength));
}

// --- MATERIAL_DEF encode/decode ---

const TEX_FLAG_DIFFUSE = 0x01;
const TEX_FLAG_NORMAL = 0x02;
const TEX_FLAG_SPECULAR = 0x04;
const TEX_FLAG_EMISSIVE = 0x08;

export function encodeMaterialDef(material: MaterialDefData): Uint8Array {
  const encoder = new TextEncoder();
  const hashBytes = encoder.encode(material.hash);

  let textureFlags = 0;
  const texHashBytesList: Uint8Array[] = [];

  if (material.diffuseTextureHash) {
    textureFlags |= TEX_FLAG_DIFFUSE;
    texHashBytesList.push(encoder.encode(material.diffuseTextureHash));
  }
  if (material.normalTextureHash) {
    textureFlags |= TEX_FLAG_NORMAL;
    texHashBytesList.push(encoder.encode(material.normalTextureHash));
  }
  if (material.specularTextureHash) {
    textureFlags |= TEX_FLAG_SPECULAR;
    texHashBytesList.push(encoder.encode(material.specularTextureHash));
  }
  if (material.emissiveTextureHash) {
    textureFlags |= TEX_FLAG_EMISSIVE;
    texHashBytesList.push(encoder.encode(material.emissiveTextureHash));
  }

  // opcode(1) + hashLen(1) + hash + 4×RGB(48) + alpha(4) + specularPower(4) + textureFlags(1)
  // + for each texture hash: hashLen(1) + hash
  let totalSize = 1 + 1 + hashBytes.length + 48 + 4 + 4 + 1;
  for (const tb of texHashBytesList) {
    totalSize += 1 + tb.length;
  }

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const arr = new Uint8Array(buf);
  let offset = 0;

  view.setUint8(offset, OPCODE_MATERIAL_DEF); offset += 1;
  view.setUint8(offset, hashBytes.length); offset += 1;
  arr.set(hashBytes, offset); offset += hashBytes.length;

  // Diffuse RGB
  view.setFloat32(offset, material.diffuseColor.r, true); offset += 4;
  view.setFloat32(offset, material.diffuseColor.g, true); offset += 4;
  view.setFloat32(offset, material.diffuseColor.b, true); offset += 4;
  // Specular RGB
  view.setFloat32(offset, material.specularColor.r, true); offset += 4;
  view.setFloat32(offset, material.specularColor.g, true); offset += 4;
  view.setFloat32(offset, material.specularColor.b, true); offset += 4;
  // Emissive RGB
  view.setFloat32(offset, material.emissiveColor.r, true); offset += 4;
  view.setFloat32(offset, material.emissiveColor.g, true); offset += 4;
  view.setFloat32(offset, material.emissiveColor.b, true); offset += 4;
  // Ambient RGB
  view.setFloat32(offset, material.ambientColor.r, true); offset += 4;
  view.setFloat32(offset, material.ambientColor.g, true); offset += 4;
  view.setFloat32(offset, material.ambientColor.b, true); offset += 4;

  // Alpha + specularPower
  view.setFloat32(offset, material.alpha, true); offset += 4;
  view.setFloat32(offset, material.specularPower, true); offset += 4;

  // Texture flags
  view.setUint8(offset, textureFlags); offset += 1;

  // Texture hashes (in flag order)
  for (const tb of texHashBytesList) {
    view.setUint8(offset, tb.length); offset += 1;
    arr.set(tb, offset); offset += tb.length;
  }

  return arr;
}

export function decodeMaterialDef(data: Uint8Array): MaterialDefData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 1; // skip opcode

  const hashLength = view.getUint8(offset); offset += 1;
  const hash = decoder.decode(data.subarray(offset, offset + hashLength));
  offset += hashLength;

  // Diffuse RGB
  const dr = view.getFloat32(offset, true); offset += 4;
  const dg = view.getFloat32(offset, true); offset += 4;
  const db = view.getFloat32(offset, true); offset += 4;
  // Specular RGB
  const sr = view.getFloat32(offset, true); offset += 4;
  const sg = view.getFloat32(offset, true); offset += 4;
  const sb = view.getFloat32(offset, true); offset += 4;
  // Emissive RGB
  const er = view.getFloat32(offset, true); offset += 4;
  const eg = view.getFloat32(offset, true); offset += 4;
  const eb = view.getFloat32(offset, true); offset += 4;
  // Ambient RGB
  const ar = view.getFloat32(offset, true); offset += 4;
  const ag = view.getFloat32(offset, true); offset += 4;
  const ab = view.getFloat32(offset, true); offset += 4;

  // Alpha + specularPower
  const alpha = view.getFloat32(offset, true); offset += 4;
  const specularPower = view.getFloat32(offset, true); offset += 4;

  // Texture flags
  const textureFlags = view.getUint8(offset); offset += 1;

  const result: MaterialDefData = {
    hash,
    diffuseColor: { r: dr, g: dg, b: db },
    specularColor: { r: sr, g: sg, b: sb },
    emissiveColor: { r: er, g: eg, b: eb },
    ambientColor: { r: ar, g: ag, b: ab },
    alpha,
    specularPower,
  };

  if (textureFlags & TEX_FLAG_DIFFUSE) {
    const len = view.getUint8(offset); offset += 1;
    result.diffuseTextureHash = decoder.decode(data.subarray(offset, offset + len));
    offset += len;
  }
  if (textureFlags & TEX_FLAG_NORMAL) {
    const len = view.getUint8(offset); offset += 1;
    result.normalTextureHash = decoder.decode(data.subarray(offset, offset + len));
    offset += len;
  }
  if (textureFlags & TEX_FLAG_SPECULAR) {
    const len = view.getUint8(offset); offset += 1;
    result.specularTextureHash = decoder.decode(data.subarray(offset, offset + len));
    offset += len;
  }
  if (textureFlags & TEX_FLAG_EMISSIVE) {
    const len = view.getUint8(offset); offset += 1;
    result.emissiveTextureHash = decoder.decode(data.subarray(offset, offset + len));
    offset += len;
  }

  return result;
}

/** Read just the hash from a MATERIAL_DEF header. */
export function readHashFromMaterialDef(data: Uint8Array): string {
  const decoder = new TextDecoder();
  const hashLength = data[1];
  return decoder.decode(data.subarray(2, 2 + hashLength));
}
