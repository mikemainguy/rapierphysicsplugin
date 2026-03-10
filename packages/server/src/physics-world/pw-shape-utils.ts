import type RAPIER from '@dimforge/rapier3d-compat';
import type { ShapeDescriptor, Vec3 } from '@rapierphysicsplugin/shared';

export function toFloat32Array(data: unknown): Float32Array {
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    const aligned = new ArrayBuffer(view.byteLength);
    new Uint8Array(aligned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Float32Array(aligned);
  }
  if (Array.isArray(data)) return new Float32Array(data);
  return new Float32Array(data as ArrayLike<number>);
}

export function toUint32Array(data: unknown): Uint32Array {
  if (data instanceof Uint32Array) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as Uint8Array;
    const aligned = new ArrayBuffer(view.byteLength);
    new Uint8Array(aligned).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Uint32Array(aligned);
  }
  if (Array.isArray(data)) return new Uint32Array(data);
  return new Uint32Array(data as ArrayLike<number>);
}

export function createColliderDesc(
  rapier: typeof RAPIER,
  shape: ShapeDescriptor,
): RAPIER.ColliderDesc | null {
  switch (shape.type) {
    case 'box': {
      const p = shape.params as { halfExtents: Vec3 };
      return rapier.ColliderDesc.cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z);
    }
    case 'sphere': {
      const p = shape.params as { radius: number };
      return rapier.ColliderDesc.ball(p.radius);
    }
    case 'capsule': {
      const p = shape.params as { halfHeight: number; radius: number };
      return rapier.ColliderDesc.capsule(p.halfHeight, p.radius);
    }
    case 'cylinder': {
      const p = shape.params as { halfHeight: number; radius: number };
      return rapier.ColliderDesc.cylinder(p.halfHeight, p.radius);
    }
    case 'mesh': {
      const p = shape.params as { vertices: Float32Array; indices: Uint32Array };
      return rapier.ColliderDesc.trimesh(toFloat32Array(p.vertices), toUint32Array(p.indices));
    }
    case 'convex_hull': {
      const p = shape.params as { vertices: Float32Array };
      return rapier.ColliderDesc.convexHull(toFloat32Array(p.vertices)) ?? null;
    }
    case 'heightfield': {
      const p = shape.params as { heights: Float32Array; numSamplesX: number; numSamplesZ: number; sizeX: number; sizeZ: number };
      const nrows = p.numSamplesZ - 1;
      const ncols = p.numSamplesX - 1;
      return rapier.ColliderDesc.heightfield(
        nrows, ncols, toFloat32Array(p.heights),
        new rapier.Vector3(p.sizeX, 1, p.sizeZ),
        rapier.HeightFieldFlags.FIX_INTERNAL_EDGES,
      );
    }
    default:
      return null;
  }
}

export function createShapeFromDescriptor(
  rapier: typeof RAPIER,
  desc: ShapeDescriptor,
): RAPIER.Shape | null {
  switch (desc.type) {
    case 'box': {
      const p = desc.params as { halfExtents: Vec3 };
      return new rapier.Cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z);
    }
    case 'sphere': {
      const p = desc.params as { radius: number };
      return new rapier.Ball(p.radius);
    }
    case 'capsule': {
      const p = desc.params as { halfHeight: number; radius: number };
      return new rapier.Capsule(p.halfHeight, p.radius);
    }
    case 'cylinder': {
      const p = desc.params as { halfHeight: number; radius: number };
      return new rapier.Cylinder(p.halfHeight, p.radius);
    }
    case 'convex_hull': {
      const p = desc.params as { vertices: Float32Array };
      return new rapier.ConvexPolyhedron(toFloat32Array(p.vertices), null);
    }
    case 'mesh':
    case 'heightfield':
      // Rapier cannot use trimeshes or heightfields as query shapes
      return null;
    default:
      return null;
  }
}
