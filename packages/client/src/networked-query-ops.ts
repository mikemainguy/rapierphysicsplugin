import type { Vector3, Quaternion, PhysicsBody } from '@babylonjs/core';
import type {
  InputAction,
  Vec3,
  Quat,
  ShapeDescriptor,
  ShapeCastResponse,
  ShapeProximityResponse,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import type { NetworkedPluginState } from './networked-plugin-types.js';

function vec3ToPlain(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

export function applyForce(state: NetworkedPluginState, body: PhysicsBody, force: Vector3, location: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'applyForce', bodyId, data: { force: vec3ToPlain(force), point: vec3ToPlain(location) } }]);
}

export function applyImpulse(state: NetworkedPluginState, body: PhysicsBody, impulse: Vector3, location: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'applyImpulse', bodyId, data: { impulse: vec3ToPlain(impulse), point: vec3ToPlain(location) } }]);
}

export function applyAngularImpulse(state: NetworkedPluginState, body: PhysicsBody, angularImpulse: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'applyAngularImpulse', bodyId, data: { angImpulse: vec3ToPlain(angularImpulse) } }]);
}

export function applyTorque(state: NetworkedPluginState, body: PhysicsBody, torque: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'applyTorque', bodyId, data: { torque: vec3ToPlain(torque) } }]);
}

export function setLinearVelocity(state: NetworkedPluginState, body: PhysicsBody, linVel: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'setVelocity', bodyId, data: { linVel: vec3ToPlain(linVel) } }]);
}

export function setAngularVelocity(state: NetworkedPluginState, body: PhysicsBody, angVel: Vector3): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([{ type: 'setAngularVelocity', bodyId, data: { angVel: vec3ToPlain(angVel) } }]);
}

export function setTargetTransform(
  state: NetworkedPluginState,
  body: PhysicsBody,
  position: Vector3,
  rotation: Quaternion,
): void {
  const bodyId = state.bodyToId.get(body);
  if (!bodyId) return;
  state.syncClient.sendInput([
    { type: 'setPosition', bodyId, data: { position: vec3ToPlain(position) } },
    { type: 'setRotation', bodyId, data: { rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } } },
  ]);
}

export async function shapeCastAsync(
  state: NetworkedPluginState,
  shape: ShapeDescriptor,
  startPosition: Vec3,
  endPosition: Vec3,
  rotation: Quat,
  ignoreBodyId?: string,
): Promise<ShapeCastResponse & { hitBody?: PhysicsBody }> {
  const response = await state.syncClient.shapeCastQuery(shape, startPosition, endPosition, rotation, ignoreBodyId);
  return {
    ...response,
    hitBody: response.hitBodyId ? state.idToBody.get(response.hitBodyId) : undefined,
  };
}

export async function shapeProximityAsync(
  state: NetworkedPluginState,
  shape: ShapeDescriptor,
  position: Vec3,
  rotation: Quat,
  maxDistance: number,
  ignoreBodyId?: string,
): Promise<ShapeProximityResponse & { hitBody?: PhysicsBody }> {
  const response = await state.syncClient.shapeProximityQuery(shape, position, rotation, maxDistance, ignoreBodyId);
  return {
    ...response,
    hitBody: response.hitBodyId ? state.idToBody.get(response.hitBodyId) : undefined,
  };
}

export async function pointProximityAsync(
  state: NetworkedPluginState,
  position: Vec3,
  maxDistance: number,
  ignoreBodyId?: string,
): Promise<PointProximityResponse & { hitBody?: PhysicsBody }> {
  const response = await state.syncClient.pointProximityQuery(position, maxDistance, ignoreBodyId);
  return {
    ...response,
    hitBody: response.hitBodyId ? state.idToBody.get(response.hitBodyId) : undefined,
  };
}
