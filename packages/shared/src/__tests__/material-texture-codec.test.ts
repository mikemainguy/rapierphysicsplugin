import { describe, it, expect } from 'vitest';
import {
  OPCODE_MATERIAL_DEF,
  OPCODE_TEXTURE_DEF,
  computeTextureHash,
  computeMaterialHash,
  encodeTextureDef,
  decodeTextureDef,
  readHashFromTextureDef,
  encodeMaterialDef,
  decodeMaterialDef,
  readHashFromMaterialDef,
} from '../index.js';
import type { MaterialDefData } from '../index.js';

// --- Test data helpers ---

function makeFakeImage(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (i * seed + 37) & 0xff;
  }
  return data;
}

const defaultColors = {
  diffuse: { r: 0.9, g: 0.2, b: 0.2 },
  specular: { r: 0.3, g: 0.3, b: 0.3 },
  emissive: { r: 0, g: 0, b: 0 },
  ambient: { r: 0, g: 0, b: 0 },
};

// --- Texture hash tests ---

describe('computeTextureHash', () => {
  it('should return consistent hash for identical data', () => {
    const img1 = makeFakeImage(256, 1);
    const img2 = makeFakeImage(256, 1);
    expect(computeTextureHash(img1)).toBe(computeTextureHash(img2));
  });

  it('should produce different hashes for different data', () => {
    const img1 = makeFakeImage(256, 1);
    const img2 = makeFakeImage(256, 2);
    expect(computeTextureHash(img1)).not.toBe(computeTextureHash(img2));
  });

  it('should match format "tex-{dataLength}-{hex8}"', () => {
    const img = makeFakeImage(128, 42);
    const hash = computeTextureHash(img);
    const match = hash.match(/^tex-(\d+)-([0-9a-f]{8})$/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(128);
  });
});

// --- Material hash tests ---

describe('computeMaterialHash', () => {
  it('should return consistent hash for identical properties', () => {
    const hash1 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    const hash2 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes when colors differ', () => {
    const hash1 = computeMaterialHash(
      { r: 0.9, g: 0.2, b: 0.2 }, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    const hash2 = computeMaterialHash(
      { r: 0.2, g: 0.9, b: 0.2 }, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes when alpha differs', () => {
    const hash1 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    const hash2 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      0.5, 64,
    );
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes when specularPower differs', () => {
    const hash1 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    const hash2 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 128,
    );
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hashes when texture hashes differ', () => {
    const hash1 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64, 'tex-100-aabbccdd',
    );
    const hash2 = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64, 'tex-100-11223344',
    );
    expect(hash1).not.toBe(hash2);
  });

  it('should match format "mat-{hex8}"', () => {
    const hash = computeMaterialHash(
      defaultColors.diffuse, defaultColors.specular,
      defaultColors.emissive, defaultColors.ambient,
      1, 64,
    );
    const match = hash.match(/^mat-([0-9a-f]{8})$/);
    expect(match).not.toBeNull();
  });
});

// --- TEXTURE_DEF encode/decode ---

describe('encodeTextureDef / decodeTextureDef', () => {
  it('should round-trip hash and image data', () => {
    const img = makeFakeImage(512, 7);
    const hash = computeTextureHash(img);
    const encoded = encodeTextureDef(hash, img);
    const decoded = decodeTextureDef(encoded);

    expect(decoded.hash).toBe(hash);
    expect(decoded.imageData).toEqual(img);
  });

  it('should have correct opcode byte', () => {
    const img = makeFakeImage(16, 1);
    const hash = computeTextureHash(img);
    const encoded = encodeTextureDef(hash, img);
    expect(encoded[0]).toBe(OPCODE_TEXTURE_DEF);
    expect(encoded[0]).toBe(0x07);
  });
});

// --- MATERIAL_DEF encode/decode ---

describe('encodeMaterialDef / decodeMaterialDef', () => {
  it('should round-trip without texture hashes', () => {
    const matDef: MaterialDefData = {
      hash: 'mat-aabbccdd',
      diffuseColor: { r: 0.9, g: 0.2, b: 0.2 },
      specularColor: { r: 0.3, g: 0.3, b: 0.3 },
      emissiveColor: { r: 0.1, g: 0.1, b: 0 },
      ambientColor: { r: 0.05, g: 0.05, b: 0.05 },
      alpha: 0.8,
      specularPower: 32,
    };

    const encoded = encodeMaterialDef(matDef);
    const decoded = decodeMaterialDef(encoded);

    expect(decoded.hash).toBe(matDef.hash);
    expect(decoded.diffuseColor.r).toBeCloseTo(matDef.diffuseColor.r, 5);
    expect(decoded.diffuseColor.g).toBeCloseTo(matDef.diffuseColor.g, 5);
    expect(decoded.diffuseColor.b).toBeCloseTo(matDef.diffuseColor.b, 5);
    expect(decoded.specularColor.r).toBeCloseTo(matDef.specularColor.r, 5);
    expect(decoded.specularColor.g).toBeCloseTo(matDef.specularColor.g, 5);
    expect(decoded.specularColor.b).toBeCloseTo(matDef.specularColor.b, 5);
    expect(decoded.emissiveColor.r).toBeCloseTo(matDef.emissiveColor.r, 5);
    expect(decoded.emissiveColor.g).toBeCloseTo(matDef.emissiveColor.g, 5);
    expect(decoded.emissiveColor.b).toBeCloseTo(matDef.emissiveColor.b, 5);
    expect(decoded.ambientColor.r).toBeCloseTo(matDef.ambientColor.r, 5);
    expect(decoded.ambientColor.g).toBeCloseTo(matDef.ambientColor.g, 5);
    expect(decoded.ambientColor.b).toBeCloseTo(matDef.ambientColor.b, 5);
    expect(decoded.alpha).toBeCloseTo(0.8, 5);
    expect(decoded.specularPower).toBeCloseTo(32, 5);
    expect(decoded.diffuseTextureHash).toBeUndefined();
    expect(decoded.normalTextureHash).toBeUndefined();
    expect(decoded.specularTextureHash).toBeUndefined();
    expect(decoded.emissiveTextureHash).toBeUndefined();
  });

  it('should round-trip with all texture hashes', () => {
    const matDef: MaterialDefData = {
      hash: 'mat-11223344',
      diffuseColor: { r: 1, g: 1, b: 1 },
      specularColor: { r: 0.5, g: 0.5, b: 0.5 },
      emissiveColor: { r: 0, g: 0, b: 0 },
      ambientColor: { r: 0, g: 0, b: 0 },
      alpha: 1,
      specularPower: 64,
      diffuseTextureHash: 'tex-1024-aaaaaaaa',
      normalTextureHash: 'tex-2048-bbbbbbbb',
      specularTextureHash: 'tex-512-cccccccc',
      emissiveTextureHash: 'tex-256-dddddddd',
    };

    const encoded = encodeMaterialDef(matDef);
    const decoded = decodeMaterialDef(encoded);

    expect(decoded.hash).toBe(matDef.hash);
    expect(decoded.diffuseTextureHash).toBe('tex-1024-aaaaaaaa');
    expect(decoded.normalTextureHash).toBe('tex-2048-bbbbbbbb');
    expect(decoded.specularTextureHash).toBe('tex-512-cccccccc');
    expect(decoded.emissiveTextureHash).toBe('tex-256-dddddddd');
  });

  it('should round-trip with partial texture hashes', () => {
    const matDef: MaterialDefData = {
      hash: 'mat-55667788',
      diffuseColor: { r: 0.5, g: 0.5, b: 0.5 },
      specularColor: { r: 0.3, g: 0.3, b: 0.3 },
      emissiveColor: { r: 0, g: 0, b: 0 },
      ambientColor: { r: 0, g: 0, b: 0 },
      alpha: 1,
      specularPower: 64,
      diffuseTextureHash: 'tex-1024-aaaaaaaa',
      // no normal, specular, or emissive texture
    };

    const encoded = encodeMaterialDef(matDef);
    const decoded = decodeMaterialDef(encoded);

    expect(decoded.diffuseTextureHash).toBe('tex-1024-aaaaaaaa');
    expect(decoded.normalTextureHash).toBeUndefined();
    expect(decoded.specularTextureHash).toBeUndefined();
    expect(decoded.emissiveTextureHash).toBeUndefined();
  });

  it('should have correct opcode byte', () => {
    const matDef: MaterialDefData = {
      hash: 'mat-00000000',
      diffuseColor: { r: 0, g: 0, b: 0 },
      specularColor: { r: 0, g: 0, b: 0 },
      emissiveColor: { r: 0, g: 0, b: 0 },
      ambientColor: { r: 0, g: 0, b: 0 },
      alpha: 1,
      specularPower: 64,
    };
    const encoded = encodeMaterialDef(matDef);
    expect(encoded[0]).toBe(OPCODE_MATERIAL_DEF);
    expect(encoded[0]).toBe(0x06);
  });
});

// --- Fast header readers ---

describe('readHashFromTextureDef', () => {
  it('should read hash without full decode', () => {
    const img = makeFakeImage(100, 3);
    const hash = computeTextureHash(img);
    const encoded = encodeTextureDef(hash, img);

    const fastHash = readHashFromTextureDef(encoded);
    expect(fastHash).toBe(hash);
  });
});

describe('readHashFromMaterialDef', () => {
  it('should read hash without full decode', () => {
    const matDef: MaterialDefData = {
      hash: 'mat-aabbccdd',
      diffuseColor: { r: 0.5, g: 0.5, b: 0.5 },
      specularColor: { r: 0.3, g: 0.3, b: 0.3 },
      emissiveColor: { r: 0, g: 0, b: 0 },
      ambientColor: { r: 0, g: 0, b: 0 },
      alpha: 1,
      specularPower: 64,
    };
    const encoded = encodeMaterialDef(matDef);

    const fastHash = readHashFromMaterialDef(encoded);
    expect(fastHash).toBe('mat-aabbccdd');
  });
});
