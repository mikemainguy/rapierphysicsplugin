import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, BoundingBox, PhysicsShapeType } from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeParameters,
  PhysicsMaterial,
  Nullable,
  Quaternion,
} from '@babylonjs/core';
import type { RapierPluginState } from './types.js';

export function initShape(state: RapierPluginState, shape: PhysicsShape, type: PhysicsShapeType, options: PhysicsShapeParameters): void {
  let colliderDesc: RAPIER.ColliderDesc;

  switch (type) {
    case PhysicsShapeType.BOX: {
      const ext = options.extents ?? new Vector3(1, 1, 1);
      colliderDesc = state.rapier.ColliderDesc.cuboid(ext.x / 2, ext.y / 2, ext.z / 2);
      break;
    }
    case PhysicsShapeType.SPHERE: {
      const r = options.radius ?? 0.5;
      colliderDesc = state.rapier.ColliderDesc.ball(r);
      break;
    }
    case PhysicsShapeType.CAPSULE: {
      const pointA = options.pointA ?? new Vector3(0, 0, 0);
      const pointB = options.pointB ?? new Vector3(0, 1, 0);
      const halfHeight = Vector3.Distance(pointA, pointB) / 2;
      const radius = options.radius ?? 0.5;
      colliderDesc = state.rapier.ColliderDesc.capsule(halfHeight, radius);
      break;
    }
    case PhysicsShapeType.CYLINDER: {
      const pointA = options.pointA ?? new Vector3(0, 0, 0);
      const pointB = options.pointB ?? new Vector3(0, 1, 0);
      const halfHeight = Vector3.Distance(pointA, pointB) / 2;
      const radius = options.radius ?? 0.5;
      colliderDesc = state.rapier.ColliderDesc.cylinder(halfHeight, radius);
      break;
    }
    case PhysicsShapeType.MESH: {
      const mesh = options.mesh;
      if (mesh) {
        const positions = mesh.getVerticesData('position');
        const indices = mesh.getIndices();
        if (positions && indices) {
          const verts = new Float32Array(positions);
          const idx = new Uint32Array(indices);
          colliderDesc = state.rapier.ColliderDesc.trimesh(verts, idx);
          state.shapeRawData.set(shape, { vertices: verts, indices: idx });
        } else {
          colliderDesc = state.rapier.ColliderDesc.ball(0.5);
        }
      } else {
        colliderDesc = state.rapier.ColliderDesc.ball(0.5);
      }
      break;
    }
    case PhysicsShapeType.CONVEX_HULL: {
      const mesh = options.mesh;
      if (mesh) {
        const positions = mesh.getVerticesData('position');
        if (positions) {
          const verts = new Float32Array(positions);
          const desc = state.rapier.ColliderDesc.convexHull(verts);
          colliderDesc = desc ?? state.rapier.ColliderDesc.ball(0.5);
          state.shapeRawData.set(shape, { vertices: verts });
        } else {
          colliderDesc = state.rapier.ColliderDesc.ball(0.5);
        }
      } else {
        colliderDesc = state.rapier.ColliderDesc.ball(0.5);
      }
      break;
    }
    case PhysicsShapeType.CONTAINER: {
      colliderDesc = state.rapier.ColliderDesc.ball(0.001);
      break;
    }
    case PhysicsShapeType.HEIGHTFIELD: {
      let heights = options.heightFieldData;
      let numSamplesX = options.numHeightFieldSamplesX ?? 2;
      let numSamplesZ = options.numHeightFieldSamplesZ ?? 2;
      let sizeX = options.heightFieldSizeX ?? 1;
      let sizeZ = options.heightFieldSizeZ ?? 1;

      // Support PhysicsShapeGroundMesh: extract height data from groundMesh
      if (!heights && options.groundMesh) {
        const gm = options.groundMesh as any;
        const subdivX = (gm._subdivisionsX ?? gm.subdivisionsX ?? 1) + 1;
        const subdivZ = (gm._subdivisionsY ?? gm.subdivisionsY ?? 1) + 1;
        numSamplesX = subdivX;
        numSamplesZ = subdivZ;
        const positions = gm.getVerticesData('position');
        if (positions) {
          heights = new Float32Array(subdivX * subdivZ);
          for (let z = 0; z < subdivZ; z++) {
            for (let x = 0; x < subdivX; x++) {
              const bjsRow = (subdivZ - 1) - z; // BJS row 0 = max Z; Rapier col 0 = min Z
              const idx = (bjsRow * subdivX + x) * 3;
              heights[x * subdivZ + z] = positions[idx + 1]; // y component (column-major for Rapier)
            }
          }
          const bb = gm.getBoundingInfo().boundingBox;
          sizeX = bb.maximum.x - bb.minimum.x;
          sizeZ = bb.maximum.z - bb.minimum.z;
        }
      }

      const nrows = numSamplesZ - 1; // nrows = cells along Z axis
      const ncols = numSamplesX - 1; // ncols = cells along X axis
      if (heights) {
        colliderDesc = state.rapier.ColliderDesc.heightfield(
          nrows,
          ncols,
          heights,
          new state.rapier.Vector3(sizeX, 1, sizeZ),
          state.rapier.HeightFieldFlags.FIX_INTERNAL_EDGES
        );
        state.shapeRawData.set(shape, { heights, nrows, ncols, sizeX, sizeZ });
      } else {
        colliderDesc = state.rapier.ColliderDesc.ball(0.5);
      }
      break;
    }
    default:
      colliderDesc = state.rapier.ColliderDesc.ball(0.5);
  }

  state.shapeToColliderDesc.set(shape, colliderDesc);
  state.shapeTypeMap.set(shape, type);
}

export function setShape(state: RapierPluginState, body: PhysicsBody, shape: Nullable<PhysicsShape>): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  const oldShape = state.bodyToShape.get(body);
  if (oldShape) {
    state.shapeToBody.delete(oldShape);
    state.bodyToShape.delete(body);
  }

  const existing = state.bodyToColliders.get(body) ?? [];
  for (const col of existing) {
    state.colliderHandleToBody.delete(col.handle);
    state.world.removeCollider(col, false);
  }

  if (!shape) {
    state.bodyToColliders.set(body, []);
    return;
  }

  state.bodyToShape.set(body, shape);
  state.shapeToBody.set(shape, body);

  const shapeType = state.shapeTypeMap.get(shape);
  if (shapeType === PhysicsShapeType.CONTAINER) {
    rebuildCompoundColliders(state, body, shape);
    return;
  }

  const desc = state.shapeToColliderDesc.get(shape);
  if (!desc) return;

  const collider = state.world.createCollider(desc, rb);
  applyShapePropertiesToCollider(state, collider, shape);
  state.colliderHandleToBody.set(collider.handle, body);
  state.bodyToColliders.set(body, [collider]);
}

export function disposeShape(state: RapierPluginState, shape: PhysicsShape): void {
  state.shapeToColliderDesc.delete(shape);
  state.shapeTypeMap.delete(shape);
  state.shapeMaterialMap.delete(shape);
  state.shapeDensityMap.delete(shape);
  state.shapeFilterMembership.delete(shape);
  state.shapeFilterCollide.delete(shape);
  state.triggerShapes.delete(shape);
  state.compoundChildren.delete(shape);
  state.shapeToBody.delete(shape);
  state.shapeRawData.delete(shape);
}

export function setMaterial(state: RapierPluginState, shape: PhysicsShape, material: PhysicsMaterial): void {
  state.shapeMaterialMap.set(shape, material);
  for (const collider of getCollidersForShape(state, shape)) {
    if (material.friction !== undefined) collider.setFriction(material.friction);
    if (material.restitution !== undefined) collider.setRestitution(material.restitution);
  }
}

export function getMaterial(state: RapierPluginState, shape: PhysicsShape): PhysicsMaterial {
  return state.shapeMaterialMap.get(shape) ?? { friction: 0.5, restitution: 0 };
}

export function setDensity(state: RapierPluginState, shape: PhysicsShape, density: number): void {
  state.shapeDensityMap.set(shape, density);
  for (const collider of getCollidersForShape(state, shape)) {
    collider.setDensity(density);
  }
}

export function getDensity(state: RapierPluginState, shape: PhysicsShape): number {
  return state.shapeDensityMap.get(shape) ?? 1.0;
}

export function setTrigger(state: RapierPluginState, shape: PhysicsShape, isTrigger: boolean): void {
  if (isTrigger) {
    state.triggerShapes.add(shape);
  } else {
    state.triggerShapes.delete(shape);
  }
  for (const collider of getCollidersForShape(state, shape)) {
    collider.setSensor(isTrigger);
  }
}

export function setShapeFilterMembershipMask(state: RapierPluginState, shape: PhysicsShape, membershipMask: number): void {
  state.shapeFilterMembership.set(shape, membershipMask);
  applyCollisionGroups(state, shape);
}

export function getShapeFilterMembershipMask(state: RapierPluginState, shape: PhysicsShape): number {
  return state.shapeFilterMembership.get(shape) ?? 0xFFFFFFFF;
}

export function setShapeFilterCollideMask(state: RapierPluginState, shape: PhysicsShape, collideMask: number): void {
  state.shapeFilterCollide.set(shape, collideMask);
  applyCollisionGroups(state, shape);
}

export function getShapeFilterCollideMask(state: RapierPluginState, shape: PhysicsShape): number {
  return state.shapeFilterCollide.get(shape) ?? 0xFFFFFFFF;
}

export function addChild(state: RapierPluginState, shape: PhysicsShape, newChild: PhysicsShape, translation?: Vector3, rotation?: Quaternion, scale?: Vector3): void {
  let children = state.compoundChildren.get(shape);
  if (!children) {
    children = [];
    state.compoundChildren.set(shape, children);
  }
  children.push({ child: newChild, translation, rotation, scale });

  const body = state.shapeToBody.get(shape);
  if (body) {
    rebuildCompoundColliders(state, body, shape);
  }
}

export function removeChild(state: RapierPluginState, shape: PhysicsShape, childIndex: number): void {
  const children = state.compoundChildren.get(shape);
  if (!children || childIndex < 0 || childIndex >= children.length) return;
  children.splice(childIndex, 1);

  const body = state.shapeToBody.get(shape);
  if (body) {
    rebuildCompoundColliders(state, body, shape);
  }
}

export function getNumChildren(state: RapierPluginState, shape: PhysicsShape): number {
  return state.compoundChildren.get(shape)?.length ?? 0;
}

export function getBoundingBox(state: RapierPluginState, shape: PhysicsShape): BoundingBox {
  const colliders = getCollidersForShape(state, shape);
  if (colliders.length === 0) {
    return new BoundingBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  }
  return computeColliderBoundingBox(state, colliders[0]);
}

export function getBodyBoundingBox(state: RapierPluginState, body: PhysicsBody): BoundingBox {
  const colliders = state.bodyToColliders.get(body) ?? [];
  if (colliders.length === 0) {
    return new BoundingBox(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const collider of colliders) {
    const bb = computeColliderBoundingBox(state, collider);
    minX = Math.min(minX, bb.minimum.x);
    minY = Math.min(minY, bb.minimum.y);
    minZ = Math.min(minZ, bb.minimum.z);
    maxX = Math.max(maxX, bb.maximum.x);
    maxY = Math.max(maxY, bb.maximum.y);
    maxZ = Math.max(maxZ, bb.maximum.z);
  }

  return new BoundingBox(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

function getCollidersForShape(state: RapierPluginState, shape: PhysicsShape): RAPIER.Collider[] {
  const body = state.shapeToBody.get(shape);
  if (!body) return [];
  return state.bodyToColliders.get(body) ?? [];
}

function applyCollisionGroups(state: RapierPluginState, shape: PhysicsShape): void {
  const membership = state.shapeFilterMembership.get(shape) ?? 0xFFFF;
  const collide = state.shapeFilterCollide.get(shape) ?? 0xFFFF;
  const groups = ((membership & 0xFFFF) << 16) | (collide & 0xFFFF);
  for (const collider of getCollidersForShape(state, shape)) {
    collider.setCollisionGroups(groups);
  }
}

function applyShapePropertiesToCollider(state: RapierPluginState, collider: RAPIER.Collider, shape: PhysicsShape): void {
  const material = state.shapeMaterialMap.get(shape);
  if (material) {
    if (material.friction !== undefined) collider.setFriction(material.friction);
    if (material.restitution !== undefined) collider.setRestitution(material.restitution);
  }
  const density = state.shapeDensityMap.get(shape);
  if (density !== undefined) collider.setDensity(density);
  if (state.triggerShapes.has(shape)) collider.setSensor(true);
  const membership = state.shapeFilterMembership.get(shape) ?? 0xFFFF;
  const collide = state.shapeFilterCollide.get(shape) ?? 0xFFFF;
  const groups = ((membership & 0xFFFF) << 16) | (collide & 0xFFFF);
  collider.setCollisionGroups(groups);
  collider.setActiveEvents(state.rapier.ActiveEvents.COLLISION_EVENTS);
}

function computeColliderBoundingBox(state: RapierPluginState, collider: RAPIER.Collider): BoundingBox {
  const shapeType = collider.shapeType();
  const RAPIER = state.rapier;
  const t = collider.translation();

  if (shapeType === RAPIER.ShapeType.Cuboid) {
    const he = collider.halfExtents();
    return new BoundingBox(
      new Vector3(t.x - he.x, t.y - he.y, t.z - he.z),
      new Vector3(t.x + he.x, t.y + he.y, t.z + he.z)
    );
  } else if (shapeType === RAPIER.ShapeType.Ball) {
    const r = collider.radius();
    return new BoundingBox(
      new Vector3(t.x - r, t.y - r, t.z - r),
      new Vector3(t.x + r, t.y + r, t.z + r)
    );
  } else if (shapeType === RAPIER.ShapeType.Capsule) {
    const r = collider.radius();
    const hh = collider.halfHeight();
    return new BoundingBox(
      new Vector3(t.x - r, t.y - hh - r, t.z - r),
      new Vector3(t.x + r, t.y + hh + r, t.z + r)
    );
  } else if (shapeType === RAPIER.ShapeType.Cylinder) {
    const r = collider.radius();
    const hh = collider.halfHeight();
    return new BoundingBox(
      new Vector3(t.x - r, t.y - hh, t.z - r),
      new Vector3(t.x + r, t.y + hh, t.z + r)
    );
  } else if (shapeType === RAPIER.ShapeType.ConvexPolyhedron
    || shapeType === RAPIER.ShapeType.TriMesh
    || shapeType === RAPIER.ShapeType.HeightField) {
    // Use Rapier's AABB computation for complex shapes
    const aabb = (collider as any).aabb();
    if (aabb) {
      return new BoundingBox(
        new Vector3(aabb.mins.x, aabb.mins.y, aabb.mins.z),
        new Vector3(aabb.maxs.x, aabb.maxs.y, aabb.maxs.z)
      );
    }
  }

  return new BoundingBox(
    new Vector3(t.x - 0.5, t.y - 0.5, t.z - 0.5),
    new Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5)
  );
}

function rebuildCompoundColliders(state: RapierPluginState, body: PhysicsBody, shape: PhysicsShape): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  const existing = state.bodyToColliders.get(body) ?? [];
  for (const col of existing) {
    state.colliderHandleToBody.delete(col.handle);
    state.world.removeCollider(col, false);
  }

  const children = state.compoundChildren.get(shape) ?? [];
  const newColliders: RAPIER.Collider[] = [];

  for (const entry of children) {
    const childDesc = state.shapeToColliderDesc.get(entry.child);
    if (!childDesc) continue;

    if (entry.translation) {
      childDesc.setTranslation(entry.translation.x, entry.translation.y, entry.translation.z);
    }
    if (entry.rotation) {
      childDesc.setRotation(new state.rapier.Quaternion(entry.rotation.x, entry.rotation.y, entry.rotation.z, entry.rotation.w));
    }

    const collider = state.world.createCollider(childDesc, rb);
    applyShapePropertiesToCollider(state, collider, shape);
    state.colliderHandleToBody.set(collider.handle, body);
    newColliders.push(collider);
  }

  state.bodyToColliders.set(body, newColliders);
}
