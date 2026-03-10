import {
  VertexData,
  StandardMaterial,
  Color3,
  Texture,
  Mesh,
} from '@babylonjs/core';
import type { PhysicsBody, Scene, BaseTexture } from '@babylonjs/core';
import type {
  MeshBinaryMessage,
  GeometryDefData,
  MeshRefData,
  MaterialDefData,
  TextureDefData,
} from '@rapierphysicsplugin/shared';
import {
  computeGeometryHash,
  encodeGeometryDef,
  encodeMeshRef,
  computeMaterialHash,
  encodeMaterialDef,
  computeTextureHash,
  encodeTextureDef,
} from '@rapierphysicsplugin/shared';
import type { NetworkedPluginState } from './networked-plugin-types.js';

export function sendMeshBinaryForBody(state: NetworkedPluginState, body: PhysicsBody, bodyId: string): void {
  const tn = body.transformNode;
  if (!tn || !('geometry' in tn)) return;

  const mesh = tn as Mesh;
  const positionsRaw = mesh.getVerticesData('position');
  const indicesRaw = mesh.getIndices();
  if (!positionsRaw || !indicesRaw) return;

  const positions = new Float32Array(positionsRaw);
  const indices = new Uint32Array(indicesRaw);
  const normalsRaw = mesh.getVerticesData('normal');
  const normals = normalsRaw ? new Float32Array(normalsRaw) : undefined;
  const uvsRaw = mesh.getVerticesData('uv');
  const uvs = uvsRaw ? new Float32Array(uvsRaw) : undefined;
  const colorsRaw = mesh.getVerticesData('color');
  const colors = colorsRaw ? new Float32Array(colorsRaw) : undefined;

  let diffuseColor = { r: 0.5, g: 0.5, b: 0.5 };
  let specularColor = { r: 0.3, g: 0.3, b: 0.3 };
  let emissiveColor = { r: 0, g: 0, b: 0 };
  let ambientColor = { r: 0, g: 0, b: 0 };
  let alpha = 1;
  let specularPower = 64;
  let diffuseTextureHash: string | undefined;
  let normalTextureHash: string | undefined;
  let specularTextureHash: string | undefined;
  let emissiveTextureHash: string | undefined;

  const mat = mesh.material as StandardMaterial | null;
  if (mat) {
    diffuseColor = { r: mat.diffuseColor.r, g: mat.diffuseColor.g, b: mat.diffuseColor.b };
    specularColor = { r: mat.specularColor.r, g: mat.specularColor.g, b: mat.specularColor.b };
    emissiveColor = { r: mat.emissiveColor.r, g: mat.emissiveColor.g, b: mat.emissiveColor.b };
    ambientColor = { r: mat.ambientColor.r, g: mat.ambientColor.g, b: mat.ambientColor.b };
    alpha = mat.alpha;
    specularPower = mat.specularPower;

    if (mat.diffuseTexture) {
      diffuseTextureHash = extractAndSendTexture(state, mat.diffuseTexture);
    }
    if (mat.bumpTexture) {
      normalTextureHash = extractAndSendTexture(state, mat.bumpTexture);
    }
    if (mat.specularTexture) {
      specularTextureHash = extractAndSendTexture(state, mat.specularTexture);
    }
    if (mat.emissiveTexture) {
      emissiveTextureHash = extractAndSendTexture(state, mat.emissiveTexture);
    }
  }

  const hash = computeGeometryHash(positions, normals, uvs, colors, indices);

  if (!state.sentGeometryHashes.has(hash)) {
    const geomEncoded = encodeGeometryDef(hash, positions, normals, uvs, colors, indices);
    state.syncClient.sendGeometryDef(geomEncoded);
    state.sentGeometryHashes.add(hash);
    state.geometryCache.set(hash, { hash, positions, normals, uvs, colors, indices });
  }

  const matHash = computeMaterialHash(
    diffuseColor, specularColor, emissiveColor, ambientColor,
    alpha, specularPower,
    diffuseTextureHash, normalTextureHash, specularTextureHash, emissiveTextureHash,
  );

  if (!state.sentMaterialHashes.has(matHash)) {
    const matDef: MaterialDefData = {
      hash: matHash,
      diffuseColor, specularColor, emissiveColor, ambientColor,
      alpha, specularPower,
      diffuseTextureHash, normalTextureHash, specularTextureHash, emissiveTextureHash,
    };
    const matEncoded = encodeMaterialDef(matDef);
    state.syncClient.sendMaterialDef(matEncoded);
    state.sentMaterialHashes.add(matHash);
    state.materialCache.set(matHash, matDef);
  }

  const refEncoded = encodeMeshRef(bodyId, hash, matHash);
  state.syncClient.sendMeshRef(refEncoded);
}

export function extractAndSendTexture(state: NetworkedPluginState, texture: BaseTexture): string | undefined {
  try {
    const buffer = (texture as unknown as { _buffer: ArrayBuffer | null })._buffer;
    if (!buffer) return undefined;

    const imageData = new Uint8Array(buffer);
    const texHash = computeTextureHash(imageData);

    if (!state.sentTextureHashes.has(texHash)) {
      const encoded = encodeTextureDef(texHash, imageData);
      state.syncClient.sendTextureDef(encoded);
      state.sentTextureHashes.add(texHash);
      state.textureCache.set(texHash, { hash: texHash, imageData });
    }

    return texHash;
  } catch {
    return undefined;
  }
}

export function handleMeshBinaryReceived(state: NetworkedPluginState, msg: MeshBinaryMessage): void {
  const body = state.idToBody.get(msg.bodyId);
  if (!body) return;

  const scene = state.scene;
  if (!scene) return;

  const tn = body.transformNode;
  if (!tn) return;

  const mesh = tn as Mesh;
  const vertexData = new VertexData();
  vertexData.positions = msg.positions;
  if (msg.normals) vertexData.normals = msg.normals;
  if (msg.uvs) vertexData.uvs = msg.uvs;
  if (msg.colors) vertexData.colors = msg.colors;
  vertexData.indices = msg.indices;
  vertexData.applyToMesh(mesh);

  const oldMat = mesh.material;
  if (oldMat) oldMat.dispose();
  const mat = new StandardMaterial(`${msg.bodyId}Mat_bin`, scene);
  if (msg.diffuseColor) {
    mat.diffuseColor = new Color3(msg.diffuseColor.r, msg.diffuseColor.g, msg.diffuseColor.b);
  }
  if (msg.specularColor) {
    mat.specularColor = new Color3(msg.specularColor.r, msg.specularColor.g, msg.specularColor.b);
  }
  mesh.material = mat;
}

export function handleGeometryDefReceived(state: NetworkedPluginState, data: GeometryDefData): void {
  state.geometryCache.set(data.hash, data);
  state.sentGeometryHashes.add(data.hash);
}

export function handleMeshRefReceived(state: NetworkedPluginState, data: MeshRefData): void {
  const body = state.idToBody.get(data.bodyId);
  if (!body) return;

  const scene = state.scene;
  if (!scene) return;

  const tn = body.transformNode;
  if (!tn) return;

  const geom = state.geometryCache.get(data.geometryHash);
  if (!geom) return;

  const mesh = tn as Mesh;
  const vertexData = new VertexData();
  vertexData.positions = geom.positions;
  if (geom.normals) vertexData.normals = geom.normals;
  if (geom.uvs) vertexData.uvs = geom.uvs;
  if (geom.colors) vertexData.colors = geom.colors;
  vertexData.indices = geom.indices;
  vertexData.applyToMesh(mesh);

  const matDef = state.materialCache.get(data.materialHash);
  const oldMat = mesh.material;
  if (oldMat) oldMat.dispose();
  const mat = new StandardMaterial(`${data.bodyId}Mat_ref`, scene);

  if (matDef) {
    mat.diffuseColor = new Color3(matDef.diffuseColor.r, matDef.diffuseColor.g, matDef.diffuseColor.b);
    mat.specularColor = new Color3(matDef.specularColor.r, matDef.specularColor.g, matDef.specularColor.b);
    mat.emissiveColor = new Color3(matDef.emissiveColor.r, matDef.emissiveColor.g, matDef.emissiveColor.b);
    mat.ambientColor = new Color3(matDef.ambientColor.r, matDef.ambientColor.g, matDef.ambientColor.b);
    mat.alpha = matDef.alpha;
    mat.specularPower = matDef.specularPower;

    if (matDef.diffuseTextureHash) {
      mat.diffuseTexture = createTextureFromCache(state, matDef.diffuseTextureHash, scene);
    }
    if (matDef.normalTextureHash) {
      mat.bumpTexture = createTextureFromCache(state, matDef.normalTextureHash, scene);
    }
    if (matDef.specularTextureHash) {
      mat.specularTexture = createTextureFromCache(state, matDef.specularTextureHash, scene);
    }
    if (matDef.emissiveTextureHash) {
      mat.emissiveTexture = createTextureFromCache(state, matDef.emissiveTextureHash, scene);
    }
  } else {
    mat.diffuseColor = new Color3(0.5, 0.5, 0.5);
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
  }

  mesh.material = mat;
}

export function handleMaterialDefReceived(state: NetworkedPluginState, data: MaterialDefData): void {
  state.materialCache.set(data.hash, data);
  state.sentMaterialHashes.add(data.hash);
}

export function handleTextureDefReceived(state: NetworkedPluginState, data: TextureDefData): void {
  state.textureCache.set(data.hash, data);
  state.sentTextureHashes.add(data.hash);
}

export function createTextureFromCache(state: NetworkedPluginState, hash: string, scene: Scene): Texture | null {
  const texData = state.textureCache.get(hash);
  if (!texData) return null;

  let url = state.textureObjectUrls.get(hash);
  if (!url) {
    const blob = new Blob([new Uint8Array(texData.imageData)]);
    url = URL.createObjectURL(blob);
    state.textureObjectUrls.set(hash, url);
  }

  return new Texture(url, scene);
}
