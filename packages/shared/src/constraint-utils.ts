import type RAPIER from '@dimforge/rapier3d-compat';
import type { ConstraintDescriptor, Vec3 } from './types.js';

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function toRapierVec(rapier: typeof RAPIER, v: Vec3): RAPIER.Vector3 {
  return new rapier.Vector3(v.x, v.y, v.z);
}

/**
 * Convert an axis + perpendicular axis into a quaternion frame.
 * Used for Fixed and Generic joints that require orientation frames.
 */
export function axisToFrame(rapier: typeof RAPIER, axis: Vec3, perpAxis?: Vec3): RAPIER.Quaternion {
  // Normalize axis
  const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
  const ax = len > 0 ? { x: axis.x / len, y: axis.y / len, z: axis.z / len } : { x: 1, y: 0, z: 0 };

  // Compute perpendicular axis if not provided
  let px: Vec3;
  if (perpAxis) {
    const pLen = Math.sqrt(perpAxis.x * perpAxis.x + perpAxis.y * perpAxis.y + perpAxis.z * perpAxis.z);
    px = pLen > 0 ? { x: perpAxis.x / pLen, y: perpAxis.y / pLen, z: perpAxis.z / pLen } : computePerpAxis(ax);
  } else {
    px = computePerpAxis(ax);
  }

  // Third axis = cross(ax, px)
  const bx = {
    x: ax.y * px.z - ax.z * px.y,
    y: ax.z * px.x - ax.x * px.z,
    z: ax.x * px.y - ax.y * px.x,
  };

  // Build rotation matrix [px, ax, bx] as columns → quaternion
  // Convention: X=perpAxis, Y=axis, Z=cross
  return matToQuat(rapier, px, ax, bx);
}

function computePerpAxis(ax: Vec3): Vec3 {
  // Pick the axis component with smallest magnitude and cross with it
  const absX = Math.abs(ax.x);
  const absY = Math.abs(ax.y);
  const absZ = Math.abs(ax.z);
  let candidate: Vec3;
  if (absX <= absY && absX <= absZ) {
    candidate = { x: 1, y: 0, z: 0 };
  } else if (absY <= absZ) {
    candidate = { x: 0, y: 1, z: 0 };
  } else {
    candidate = { x: 0, y: 0, z: 1 };
  }
  // Cross product: ax × candidate
  const cx = ax.y * candidate.z - ax.z * candidate.y;
  const cy = ax.z * candidate.x - ax.x * candidate.z;
  const cz = ax.x * candidate.y - ax.y * candidate.x;
  const cLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
  return { x: cx / cLen, y: cy / cLen, z: cz / cLen };
}

function matToQuat(rapier: typeof RAPIER, col0: Vec3, col1: Vec3, col2: Vec3): RAPIER.Quaternion {
  // Rotation matrix → quaternion (Shepperd's method)
  const m00 = col0.x, m10 = col0.y, m20 = col0.z;
  const m01 = col1.x, m11 = col1.y, m21 = col1.z;
  const m02 = col2.x, m12 = col2.y, m22 = col2.z;

  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return new rapier.Quaternion(x, y, z, w);
}

/**
 * Build a bitmask of locked axes for 6-DOF joints based on limits.
 * An axis with no limits entry (or min >= max with both 0) is locked.
 */
function buildAxesMask(rapier: typeof RAPIER, limits?: ConstraintDescriptor['limits']): number {
  // JointAxesMask bit values (from Rapier):
  // X=1, Y=2, Z=4, AngX=8, AngY=16, AngZ=32
  const ALL = 0x3F; // all 6 axes locked
  if (!limits || limits.length === 0) return ALL;

  let mask = ALL;
  for (const lim of limits) {
    // If there are actual limits (not just 0,0), free that axis
    if (lim.minLimit !== undefined || lim.maxLimit !== undefined) {
      const bit = 1 << lim.axis;
      mask &= ~bit; // unlock this axis
    }
  }
  return mask;
}

/**
 * Create Rapier JointData from a ConstraintDescriptor.
 * Shared between client and server.
 */
export function createJointData(rapier: typeof RAPIER, desc: ConstraintDescriptor): RAPIER.JointData {
  const a1 = toRapierVec(rapier, desc.pivotA ?? ORIGIN);
  const a2 = toRapierVec(rapier, desc.pivotB ?? ORIGIN);
  const axisA = desc.axisA ?? { x: 0, y: 1, z: 0 };
  const axisB = desc.axisB ?? { x: 0, y: 1, z: 0 };

  switch (desc.type) {
    case 'ball_and_socket':
      return rapier.JointData.spherical(a1, a2);

    case 'distance': {
      const maxDist = desc.maxDistance ?? 0;
      return rapier.JointData.rope(maxDist, a1, a2);
    }

    case 'hinge':
      return rapier.JointData.revolute(a1, a2, toRapierVec(rapier, axisA));

    case 'slider':
    case 'prismatic':
      return rapier.JointData.prismatic(a1, a2, toRapierVec(rapier, axisA));

    case 'lock': {
      const f1 = axisToFrame(rapier, axisA, desc.perpAxisA);
      const f2 = axisToFrame(rapier, axisB, desc.perpAxisB);
      return rapier.JointData.fixed(a1, f1, a2, f2);
    }

    case 'six_dof': {
      const mask = buildAxesMask(rapier, desc.limits);
      return rapier.JointData.generic(a1, a2, toRapierVec(rapier, axisA), mask);
    }

    case 'spring': {
      const rest = desc.maxDistance ?? 0;
      const stiffness = desc.stiffness ?? 1.0;
      const damping = desc.damping ?? 0.0;
      return rapier.JointData.spring(rest, stiffness, damping, a1, a2);
    }

    default:
      throw new Error(`Unknown constraint type: ${desc.type}`);
  }
}
