import type RAPIER from '@dimforge/rapier3d-compat';
import {
  PhysicsShapeType,
} from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
} from '@babylonjs/core';
import type { RapierPluginState } from './types.js';

type GeoResult = { positions: Float32Array; indices: Uint32Array } | {};

export function getBodyGeometry(state: RapierPluginState, body: PhysicsBody): GeoResult {
  const shape = state.bodyToShape.get(body);
  if (!shape) return {};

  const shapeType = state.shapeTypeMap.get(shape);
  if (shapeType === undefined) return {};

  const colliders = state.bodyToColliders.get(body);
  if (!colliders || colliders.length === 0) return {};

  switch (shapeType) {
    case PhysicsShapeType.BOX:
      return boxGeo(colliders[0]);
    case PhysicsShapeType.SPHERE:
      return sphereGeo(colliders[0]);
    case PhysicsShapeType.CAPSULE:
      return capsuleGeo(colliders[0]);
    case PhysicsShapeType.CYLINDER:
      return cylinderGeo(colliders[0]);
    case PhysicsShapeType.MESH: {
      const raw = state.shapeRawData.get(shape);
      if (raw?.vertices && raw?.indices) return { positions: raw.vertices, indices: raw.indices };
      return {};
    }
    case PhysicsShapeType.CONVEX_HULL:
      return convexHullGeo(colliders[0], shape, state);
    case PhysicsShapeType.HEIGHTFIELD:
      return heightfieldGeo(shape, state);
    case PhysicsShapeType.CONTAINER:
      return containerGeo(body, shape, state);
    default:
      return {};
  }
}

export function boxGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
  const he = collider.halfExtents();
  const hx = he.x, hy = he.y, hz = he.z;
  const positions = new Float32Array([
    -hx, -hy, -hz,   hx, -hy, -hz,   hx,  hy, -hz,  -hx,  hy, -hz,
    -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
  ]);
  const indices = new Uint32Array([
    4, 5, 6,  4, 6, 7,   // +z
    1, 0, 3,  1, 3, 2,   // -z
    5, 1, 2,  5, 2, 6,   // +x
    0, 4, 7,  0, 7, 3,   // -x
    3, 7, 6,  3, 6, 2,   // +y
    0, 1, 5,  0, 5, 4,   // -y
  ]);
  return { positions, indices };
}

export function sphereGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
  const r = collider.radius();
  const seg = 16, rings = 12;
  const positions = new Float32Array((rings + 1) * (seg + 1) * 3);
  let vi = 0;
  for (let ri = 0; ri <= rings; ri++) {
    const phi = (ri / rings) * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let si = 0; si <= seg; si++) {
      const theta = (si / seg) * Math.PI * 2;
      positions[vi++] = r * sp * Math.cos(theta);
      positions[vi++] = r * cp;
      positions[vi++] = r * sp * Math.sin(theta);
    }
  }
  const indices = new Uint32Array(rings * seg * 6);
  let ii = 0;
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < seg; si++) {
      const a = ri * (seg + 1) + si;
      const b = a + seg + 1;
      indices[ii++] = a; indices[ii++] = b;     indices[ii++] = a + 1;
      indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
    }
  }
  return { positions, indices };
}

export function capsuleGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
  const r = collider.radius();
  const hh = collider.halfHeight();
  const seg = 16, hemiRings = 8;
  const totalRings = hemiRings * 2;
  const positions = new Float32Array((totalRings + 1) * (seg + 1) * 3);
  let vi = 0;
  for (let ri = 0; ri <= totalRings; ri++) {
    const phi = (ri / totalRings) * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const yOff = ri <= hemiRings ? hh : -hh;
    for (let si = 0; si <= seg; si++) {
      const theta = (si / seg) * Math.PI * 2;
      positions[vi++] = r * sp * Math.cos(theta);
      positions[vi++] = r * cp + yOff;
      positions[vi++] = r * sp * Math.sin(theta);
    }
  }
  const indices = new Uint32Array(totalRings * seg * 6);
  let ii = 0;
  for (let ri = 0; ri < totalRings; ri++) {
    for (let si = 0; si < seg; si++) {
      const a = ri * (seg + 1) + si;
      const b = a + seg + 1;
      indices[ii++] = a; indices[ii++] = b;     indices[ii++] = a + 1;
      indices[ii++] = a + 1; indices[ii++] = b; indices[ii++] = b + 1;
    }
  }
  return { positions, indices };
}

export function cylinderGeo(collider: RAPIER.Collider): { positions: Float32Array; indices: Uint32Array } {
  const r = collider.radius();
  const hh = collider.halfHeight();
  const seg = 16;
  const positions = new Float32Array((2 + 2 * (seg + 1)) * 3);
  let vi = 0;
  // top center (0)
  positions[vi++] = 0; positions[vi++] = hh; positions[vi++] = 0;
  // top ring (1..seg+1)
  for (let s = 0; s <= seg; s++) {
    const t = (s / seg) * Math.PI * 2;
    positions[vi++] = r * Math.cos(t); positions[vi++] = hh; positions[vi++] = r * Math.sin(t);
  }
  // bottom ring (seg+2..2*seg+2)
  for (let s = 0; s <= seg; s++) {
    const t = (s / seg) * Math.PI * 2;
    positions[vi++] = r * Math.cos(t); positions[vi++] = -hh; positions[vi++] = r * Math.sin(t);
  }
  // bottom center
  positions[vi++] = 0; positions[vi++] = -hh; positions[vi++] = 0;

  const topR = 1, botR = seg + 2, botC = 2 * (seg + 1) + 1;
  const indices = new Uint32Array(seg * 4 * 3);
  let ii = 0;
  for (let s = 0; s < seg; s++) {
    // top cap
    indices[ii++] = 0;        indices[ii++] = topR + s + 1; indices[ii++] = topR + s;
    // bottom cap
    indices[ii++] = botC;     indices[ii++] = botR + s;     indices[ii++] = botR + s + 1;
    // side
    indices[ii++] = topR + s; indices[ii++] = topR + s + 1; indices[ii++] = botR + s;
    indices[ii++] = topR + s + 1; indices[ii++] = botR + s + 1; indices[ii++] = botR + s;
  }
  return { positions, indices };
}

export function convexHullGeo(collider: RAPIER.Collider, shape: PhysicsShape, state: RapierPluginState): GeoResult {
  // Try Rapier's built-in vertex/index extraction
  const verts = (collider as any).vertices?.() as Float32Array | undefined;
  const idx = (collider as any).indices?.() as Uint32Array | undefined;
  if (verts && idx && verts.length > 0 && idx.length > 0) {
    return { positions: new Float32Array(verts), indices: new Uint32Array(idx) };
  }
  // Fallback: use raw vertices (no triangulation available)
  const raw = state.shapeRawData.get(shape);
  if (raw?.vertices) return { positions: raw.vertices, indices: new Uint32Array(0) };
  return {};
}

export function heightfieldGeo(shape: PhysicsShape, state: RapierPluginState): GeoResult {
  const raw = state.shapeRawData.get(shape);
  if (!raw?.heights || raw.nrows === undefined || raw.ncols === undefined) return {};
  const nrows = raw.nrows, ncols = raw.ncols;
  const sizeX = raw.sizeX ?? 1, sizeZ = raw.sizeZ ?? 1;
  // nrows = Z cells, ncols = X cells
  const numX = ncols + 1, numZ = nrows + 1;

  const positions = new Float32Array(numX * numZ * 3);
  let vi = 0;
  for (let z = 0; z < numZ; z++) {
    for (let x = 0; x < numX; x++) {
      positions[vi++] = (x / ncols - 0.5) * sizeX;
      positions[vi++] = raw.heights[x * numZ + z]; // column-major access
      positions[vi++] = (z / nrows - 0.5) * sizeZ;
    }
  }

  const indices = new Uint32Array(nrows * ncols * 6);
  let ii = 0;
  for (let z = 0; z < nrows; z++) {
    for (let x = 0; x < ncols; x++) {
      const a = z * numX + x;
      indices[ii++] = a;     indices[ii++] = a + numX; indices[ii++] = a + 1;
      indices[ii++] = a + 1; indices[ii++] = a + numX; indices[ii++] = a + numX + 1;
    }
  }
  return { positions, indices };
}

export function containerGeo(body: PhysicsBody, shape: PhysicsShape, state: RapierPluginState): GeoResult {
  const children = state.compoundChildren.get(shape);
  const colliders = state.bodyToColliders.get(body);
  if (!children || !colliders || children.length === 0) return {};

  const parts: Array<{ positions: Float32Array; indices: Uint32Array }> = [];
  for (let i = 0; i < children.length && i < colliders.length; i++) {
    const geo = colliderGeo(colliders[i], children[i].child, state);
    if (!geo) continue;

    const t = children[i].translation;
    const r = children[i].rotation;
    if (t || r) {
      const p = geo.positions;
      for (let v = 0; v < p.length; v += 3) {
        let x = p[v], y = p[v + 1], z = p[v + 2];
        if (r) {
          const qx = r.x, qy = r.y, qz = r.z, qw = r.w;
          const ix = qw * x + qy * z - qz * y;
          const iy = qw * y + qz * x - qx * z;
          const iz = qw * z + qx * y - qy * x;
          const iw = -qx * x - qy * y - qz * z;
          x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
          y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
          z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
        }
        if (t) { x += t.x; y += t.y; z += t.z; }
        p[v] = x; p[v + 1] = y; p[v + 2] = z;
      }
    }
    parts.push(geo);
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];

  let totalV = 0, totalI = 0;
  for (const g of parts) { totalV += g.positions.length; totalI += g.indices.length; }
  const positions = new Float32Array(totalV);
  const indices = new Uint32Array(totalI);
  let vOff = 0, iOff = 0, baseV = 0;
  for (const g of parts) {
    positions.set(g.positions, vOff);
    for (let j = 0; j < g.indices.length; j++) indices[iOff + j] = g.indices[j] + baseV;
    vOff += g.positions.length;
    iOff += g.indices.length;
    baseV += g.positions.length / 3;
  }
  return { positions, indices };
}

export function colliderGeo(collider: RAPIER.Collider, childShape: PhysicsShape, state: RapierPluginState): { positions: Float32Array; indices: Uint32Array } | null {
  const st = collider.shapeType();
  const R = state.rapier;
  if (st === R.ShapeType.Cuboid) return boxGeo(collider);
  if (st === R.ShapeType.Ball) return sphereGeo(collider);
  if (st === R.ShapeType.Capsule) return capsuleGeo(collider);
  if (st === R.ShapeType.Cylinder) return cylinderGeo(collider);
  if (st === R.ShapeType.ConvexPolyhedron) {
    const g = convexHullGeo(collider, childShape, state);
    return 'positions' in g ? g as { positions: Float32Array; indices: Uint32Array } : null;
  }
  if (st === R.ShapeType.TriMesh) {
    const raw = state.shapeRawData.get(childShape);
    if (raw?.vertices && raw?.indices) return { positions: raw.vertices, indices: raw.indices };
  }
  if (st === R.ShapeType.HeightField) {
    const g = heightfieldGeo(childShape, state);
    return 'positions' in g ? g as { positions: Float32Array; indices: Uint32Array } : null;
  }
  return null;
}
