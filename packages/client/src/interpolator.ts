import type { BodyState, Vec3, Quat } from '@havokserver/shared';
import { INTERPOLATION_BUFFER_SIZE, BROADCAST_RATE } from '@havokserver/shared';

interface Snapshot {
  timestamp: number;
  state: BodyState;
}

export class Interpolator {
  private buffers: Map<string, Snapshot[]> = new Map();
  private renderDelay: number;

  constructor(renderDelayMs?: number) {
    // Default render delay: ~3x broadcast interval to absorb jitter
    this.renderDelay = renderDelayMs ?? (3 * (1000 / BROADCAST_RATE));
  }

  addSnapshot(bodyId: string, state: BodyState, timestamp: number): void {
    if (!this.buffers.has(bodyId)) {
      this.buffers.set(bodyId, []);
    }

    const buffer = this.buffers.get(bodyId)!;
    buffer.push({ timestamp, state });

    // Keep buffer limited
    while (buffer.length > INTERPOLATION_BUFFER_SIZE + 1) {
      buffer.shift();
    }
  }

  getInterpolatedState(bodyId: string, currentTime: number): BodyState | null {
    const buffer = this.buffers.get(bodyId);
    if (!buffer || buffer.length === 0) return null;

    // Render time is behind real time by renderDelay
    const renderTime = currentTime - this.renderDelay;

    // Find the two snapshots to interpolate between
    let older: Snapshot | null = null;
    let newer: Snapshot | null = null;

    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].timestamp <= renderTime && buffer[i + 1].timestamp >= renderTime) {
        older = buffer[i];
        newer = buffer[i + 1];
        break;
      }
    }

    // If we have two bracketing snapshots, interpolate
    if (older && newer) {
      const t = (renderTime - older.timestamp) / (newer.timestamp - older.timestamp);
      return interpolateBodyState(older.state, newer.state, t);
    }

    // If render time is past all snapshots, extrapolate from last
    const last = buffer[buffer.length - 1];
    if (renderTime > last.timestamp) {
      const dt = (renderTime - last.timestamp) / 1000;
      return extrapolateBodyState(last.state, dt);
    }

    // If render time is before all snapshots, return earliest
    return buffer[0].state;
  }

  removeBody(bodyId: string): void {
    this.buffers.delete(bodyId);
  }

  clear(): void {
    this.buffers.clear();
  }
}

function interpolateBodyState(a: BodyState, b: BodyState, t: number): BodyState {
  return {
    id: a.id,
    position: hermiteInterpolateVec3(a.position, a.linVel, b.position, b.linVel, t),
    rotation: slerpQuat(a.rotation, b.rotation, t),
    linVel: lerpVec3(a.linVel, b.linVel, t),
    angVel: lerpVec3(a.angVel, b.angVel, t),
  };
}

function extrapolateBodyState(state: BodyState, dt: number): BodyState {
  // Simple linear extrapolation with velocity decay
  const decay = Math.max(0, 1 - dt * 2); // Decay over 0.5 seconds
  return {
    id: state.id,
    position: {
      x: state.position.x + state.linVel.x * dt * decay,
      y: state.position.y + state.linVel.y * dt * decay,
      z: state.position.z + state.linVel.z * dt * decay,
    },
    rotation: state.rotation, // Don't extrapolate rotation
    linVel: {
      x: state.linVel.x * decay,
      y: state.linVel.y * decay,
      z: state.linVel.z * decay,
    },
    angVel: {
      x: state.angVel.x * decay,
      y: state.angVel.y * decay,
      z: state.angVel.z * decay,
    },
  };
}

function hermiteInterpolateVec3(
  p0: Vec3, v0: Vec3,
  p1: Vec3, v1: Vec3,
  t: number
): Vec3 {
  // Hermite basis functions
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return {
    x: h00 * p0.x + h10 * v0.x + h01 * p1.x + h11 * v1.x,
    y: h00 * p0.y + h10 * v0.y + h01 * p1.y + h11 * v1.y,
    z: h00 * p0.z + h10 * v0.z + h01 * p1.z + h11 * v1.z,
  };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  // If dot is negative, negate one quaternion to take the shorter path
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  // If quaternions are very close, use linear interpolation
  if (dot > 0.9995) {
    return normalizeQuat({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return {
    x: s0 * a.x + s1 * bx,
    y: s0 * a.y + s1 * by,
    z: s0 * a.z + s1 * bz,
    w: s0 * a.w + s1 * bw,
  };
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}
