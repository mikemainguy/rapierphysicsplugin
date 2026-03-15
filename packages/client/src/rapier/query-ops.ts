import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Vector3,
  PhysicsShapeType,
} from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
  PhysicsRaycastResult,
  IRaycastQuery,
} from '@babylonjs/core';
import type { IPhysicsShapeCastQuery } from '@babylonjs/core/Physics/physicsShapeCastQuery';
import type { IPhysicsShapeProximityCastQuery } from '@babylonjs/core/Physics/physicsShapeProximityCastQuery';
import type { IPhysicsPointProximityQuery } from '@babylonjs/core/Physics/physicsPointProximityQuery';
import { ShapeCastResult } from '@babylonjs/core/Physics/shapeCastResult';
import { ProximityCastResult } from '@babylonjs/core/Physics/proximityCastResult';
import type { RapierPluginState } from './types.js';

function createRapierShape(state: RapierPluginState, shape: PhysicsShape): RAPIER.Shape | null {
  const type = state.shapeTypeMap.get(shape);
  const desc = state.shapeToColliderDesc.get(shape);
  if (type === undefined || !desc) return null;

  switch (type) {
    case PhysicsShapeType.BOX: {
      const he = (desc as any).halfExtents;
      if (he) return new state.rapier.Cuboid(he.x, he.y, he.z);
      return null;
    }
    case PhysicsShapeType.SPHERE: {
      const r = (desc as any).radius;
      if (r !== undefined) return new state.rapier.Ball(r);
      return null;
    }
    case PhysicsShapeType.CAPSULE: {
      const r = (desc as any).radius;
      const hh = (desc as any).halfHeight;
      if (r !== undefined && hh !== undefined) return new state.rapier.Capsule(hh, r);
      return null;
    }
    case PhysicsShapeType.CYLINDER: {
      const r = (desc as any).radius;
      const hh = (desc as any).halfHeight;
      if (r !== undefined && hh !== undefined) return new state.rapier.Cylinder(hh, r);
      return null;
    }
    case PhysicsShapeType.CONVEX_HULL: {
      const raw = state.shapeRawData.get(shape);
      if (raw?.vertices) {
        return new state.rapier.ConvexPolyhedron(raw.vertices, null);
      }
      return null;
    }
    case PhysicsShapeType.MESH:
      // Rapier does not support trimeshes as query shapes
      return null;
    case PhysicsShapeType.HEIGHTFIELD:
      // Rapier does not support heightfields as query shapes
      return null;
    default:
      return null;
  }
}

function findBodyForColliderHandle(state: RapierPluginState, handle: number): { body: PhysicsBody; shape: PhysicsShape } | null {
  const body = state.colliderHandleToBody.get(handle);
  if (!body) return null;
  const shape = state.bodyToShape.get(body);
  if (!shape) return null;
  return { body, shape };
}

export function raycast(state: RapierPluginState, from: Vector3, to: Vector3, result: PhysicsRaycastResult | Array<PhysicsRaycastResult>, query?: IRaycastQuery): void {
  const dir = to.subtract(from);
  const maxToi = dir.length();
  const normalizedDir = dir.normalize();

  const ray = new state.rapier.Ray(
    new state.rapier.Vector3(from.x, from.y, from.z),
    new state.rapier.Vector3(normalizedDir.x, normalizedDir.y, normalizedDir.z)
  );

  let filterFlags: number | undefined;
  let filterGroups: number | undefined;

  if (query) {
    if (query.shouldHitTriggers === false) {
      filterFlags = state.rapier.QueryFilterFlags.EXCLUDE_SENSORS;
    }
    if (query.membership !== undefined || query.collideWith !== undefined) {
      const membership = query.membership ?? 0xFFFF;
      const collideWith = query.collideWith ?? 0xFFFF;
      filterGroups = (membership << 16) | collideWith;
    }
  }

  const results = Array.isArray(result) ? result : [result];
  for (const r of results) r.reset();

  // Multi-hit path: use intersectionsWithRay callback
  if (Array.isArray(result) && results.length !== 1) {
    let hitIndex = 0;
    state.world.intersectionsWithRay(ray, maxToi, true, (hit: any) => {
      if (hitIndex >= results.length) return false;
      const hitPoint = ray.pointAt(hit.timeOfImpact);
      const hitNormal = hit.normal;
      results[hitIndex].setHitData(
        new Vector3(hitNormal.x, hitNormal.y, hitNormal.z),
        new Vector3(hitPoint.x, hitPoint.y, hitPoint.z)
      );
      results[hitIndex].calculateHitDistance();
      const info = findBodyForColliderHandle(state, hit.collider?.handle);
      if (info) (results[hitIndex] as any)._body = info.body;
      hitIndex++;
      return true;
    }, filterFlags, filterGroups);
    return;
  }

  // Single-hit path
  const hit = state.world.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups);
  if (hit) {
    const hitPoint = ray.pointAt(hit.timeOfImpact);
    const hitNormal = hit.normal;
    results[0].setHitData(
      new Vector3(hitNormal.x, hitNormal.y, hitNormal.z),
      new Vector3(hitPoint.x, hitPoint.y, hitPoint.z)
    );
    results[0].calculateHitDistance();
  }
}

export function shapeCast(state: RapierPluginState, query: IPhysicsShapeCastQuery, inputShapeResult: ShapeCastResult, hitShapeResult: ShapeCastResult): void {
  const rapierShape = createRapierShape(state, query.shape);
  if (!rapierShape) return;

  const dir = query.endPosition.subtract(query.startPosition);
  const maxToi = dir.length();
  if (maxToi === 0) return;
  const vel = dir.normalize();

  const shapePos = new state.rapier.Vector3(query.startPosition.x, query.startPosition.y, query.startPosition.z);
  const shapeRot = new state.rapier.Quaternion(query.rotation.x, query.rotation.y, query.rotation.z, query.rotation.w);
  const shapeVel = new state.rapier.Vector3(vel.x, vel.y, vel.z);

  const excludeRb = query.ignoreBody ? state.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

  const hit = state.world.castShape(shapePos, shapeRot, shapeVel, rapierShape, 0, maxToi, true, undefined, undefined, undefined, excludeRb ?? undefined);
  if (hit) {
    const fraction = hit.time_of_impact / maxToi;
    const hitNormal = hit.normal1;
    const hitPoint = hit.witness1;

    inputShapeResult.setHitData(
      new Vector3(hitNormal.x, hitNormal.y, hitNormal.z),
      new Vector3(
        query.startPosition.x + vel.x * hit.time_of_impact,
        query.startPosition.y + vel.y * hit.time_of_impact,
        query.startPosition.z + vel.z * hit.time_of_impact,
      ),
    );
    inputShapeResult.setHitFraction(fraction);

    hitShapeResult.setHitData(
      new Vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z),
      new Vector3(hitPoint.x, hitPoint.y, hitPoint.z),
    );
    hitShapeResult.setHitFraction(fraction);

    const info = findBodyForColliderHandle(state, hit.collider.handle);
    if (info) {
      hitShapeResult.body = info.body;
      hitShapeResult.shape = info.shape;
    }
  }
}

export function shapeProximity(state: RapierPluginState, query: IPhysicsShapeProximityCastQuery, inputShapeResult: ProximityCastResult, hitShapeResult: ProximityCastResult): void {
  const rapierShape = createRapierShape(state, query.shape);
  if (!rapierShape) return;

  const shapePos = new state.rapier.Vector3(query.position.x, query.position.y, query.position.z);
  const shapeRot = new state.rapier.Quaternion(query.rotation.x, query.rotation.y, query.rotation.z, query.rotation.w);
  const zeroVel = new state.rapier.Vector3(0, 0, 0);

  const excludeRb = query.ignoreBody ? state.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

  const hit = state.world.castShape(shapePos, shapeRot, zeroVel, rapierShape, query.maxDistance, 0, true, undefined, undefined, undefined, excludeRb ?? undefined);
  if (hit) {
    inputShapeResult.setHitData(
      new Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
      new Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
    );
    inputShapeResult.setHitDistance(hit.time_of_impact);

    hitShapeResult.setHitData(
      new Vector3(hit.normal2.x, hit.normal2.y, hit.normal2.z),
      new Vector3(hit.witness2.x, hit.witness2.y, hit.witness2.z),
    );
    hitShapeResult.setHitDistance(hit.time_of_impact);

    const info = findBodyForColliderHandle(state, hit.collider.handle);
    if (info) {
      hitShapeResult.body = info.body;
      hitShapeResult.shape = info.shape;
    }
  }
}

export function pointProximity(state: RapierPluginState, query: IPhysicsPointProximityQuery, result: ProximityCastResult): void {
  const point = new state.rapier.Vector3(query.position.x, query.position.y, query.position.z);

  const excludeRb = query.ignoreBody ? state.bodyToRigidBody.get(query.ignoreBody) ?? null : null;

  const projection = state.world.projectPoint(point, true, undefined, undefined, undefined, excludeRb ?? undefined);
  if (projection) {
    const dist = Math.sqrt(
      (projection.point.x - query.position.x) ** 2 +
      (projection.point.y - query.position.y) ** 2 +
      (projection.point.z - query.position.z) ** 2,
    );

    if (dist <= query.maxDistance) {
      const normal = dist > 0
        ? new Vector3(
            (query.position.x - projection.point.x) / dist,
            (query.position.y - projection.point.y) / dist,
            (query.position.z - projection.point.z) / dist,
          )
        : new Vector3(0, 1, 0);

      result.setHitData(
        normal,
        new Vector3(projection.point.x, projection.point.y, projection.point.z),
      );
      result.setHitDistance(dist);

      const info = findBodyForColliderHandle(state, projection.collider.handle);
      if (info) {
        result.body = info.body;
        result.shape = info.shape;
      }
    }
  }
}
