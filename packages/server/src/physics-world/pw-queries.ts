import type {
  ShapeCastRequest,
  ShapeCastResponse,
  ShapeProximityRequest,
  ShapeProximityResponse,
  PointProximityRequest,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';
import { createShapeFromDescriptor } from './pw-shape-utils.js';

export function shapeCast(ctx: PhysicsWorldContext, request: ShapeCastRequest): ShapeCastResponse {
  const shape = createShapeFromDescriptor(ctx.rapier, request.shape);
  if (!shape) {
    return { queryId: request.queryId, hit: false };
  }

  const startPos = new ctx.rapier.Vector3(request.startPosition.x, request.startPosition.y, request.startPosition.z);
  const rotation = new ctx.rapier.Quaternion(request.rotation.x, request.rotation.y, request.rotation.z, request.rotation.w);

  const dx = request.endPosition.x - request.startPosition.x;
  const dy = request.endPosition.y - request.startPosition.y;
  const dz = request.endPosition.z - request.startPosition.z;
  const maxToi = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (maxToi < 1e-8) {
    return { queryId: request.queryId, hit: false };
  }

  const direction = new ctx.rapier.Vector3(dx / maxToi, dy / maxToi, dz / maxToi);

  const ignoreRb = request.ignoreBodyId ? ctx.bodyMap.get(request.ignoreBodyId) : undefined;
  const result = ctx.world.castShape(
    startPos, rotation, direction, shape, 0, maxToi, true,
    undefined, undefined, undefined, ignoreRb, undefined,
  );

  if (result) {
    const hitBodyId = ctx.colliderHandleToBodyId.get(result.collider.handle);
    const hitPoint = {
      x: request.startPosition.x + dx * (result.time_of_impact / maxToi),
      y: request.startPosition.y + dy * (result.time_of_impact / maxToi),
      z: request.startPosition.z + dz * (result.time_of_impact / maxToi),
    };
    const witness1 = result.witness1;
    const normal1 = result.normal1;
    return {
      queryId: request.queryId,
      hit: true,
      hitBodyId,
      fraction: result.time_of_impact / maxToi,
      point: witness1 ? { x: witness1.x, y: witness1.y, z: witness1.z } : hitPoint,
      normal: normal1 ? { x: normal1.x, y: normal1.y, z: normal1.z } : undefined,
    };
  }

  return { queryId: request.queryId, hit: false };
}

export function shapeProximity(ctx: PhysicsWorldContext, request: ShapeProximityRequest): ShapeProximityResponse {
  const shape = createShapeFromDescriptor(ctx.rapier, request.shape);
  if (!shape) {
    return { queryId: request.queryId, hit: false };
  }

  const position = new ctx.rapier.Vector3(request.position.x, request.position.y, request.position.z);
  const rotation = new ctx.rapier.Quaternion(request.rotation.x, request.rotation.y, request.rotation.z, request.rotation.w);
  const direction = new ctx.rapier.Vector3(0, 0, 0);
  const ignoreRb = request.ignoreBodyId ? ctx.bodyMap.get(request.ignoreBodyId) : undefined;

  const result = ctx.world.castShape(
    position, rotation, direction, shape, request.maxDistance, 0, true,
    undefined, undefined, undefined, ignoreRb, undefined,
  );

  if (result) {
    const hitBodyId = ctx.colliderHandleToBodyId.get(result.collider.handle);
    const witness1 = result.witness1;
    const normal1 = result.normal1;
    return {
      queryId: request.queryId,
      hit: true,
      hitBodyId,
      distance: result.time_of_impact,
      point: witness1 ? { x: witness1.x, y: witness1.y, z: witness1.z } : undefined,
      normal: normal1 ? { x: normal1.x, y: normal1.y, z: normal1.z } : undefined,
    };
  }

  return { queryId: request.queryId, hit: false };
}

export function pointProximity(ctx: PhysicsWorldContext, request: PointProximityRequest): PointProximityResponse {
  const point = new ctx.rapier.Vector3(request.position.x, request.position.y, request.position.z);
  const ignoreRb = request.ignoreBodyId ? ctx.bodyMap.get(request.ignoreBodyId) : undefined;

  const result = ctx.world.projectPoint(
    point, true,
    undefined, undefined, undefined, ignoreRb, undefined,
  );

  if (result) {
    const hitBodyId = ctx.colliderHandleToBodyId.get(result.collider.handle);
    const projected = result.point;
    const dx = projected.x - request.position.x;
    const dy = projected.y - request.position.y;
    const dz = projected.z - request.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance <= request.maxDistance) {
      const normal = distance > 1e-8
        ? { x: dx / distance, y: dy / distance, z: dz / distance }
        : { x: 0, y: 1, z: 0 };
      return {
        queryId: request.queryId,
        hit: true,
        hitBodyId,
        distance,
        point: { x: projected.x, y: projected.y, z: projected.z },
        normal,
      };
    }
  }

  return { queryId: request.queryId, hit: false };
}
