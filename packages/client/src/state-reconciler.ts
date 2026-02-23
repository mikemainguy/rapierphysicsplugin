import type { BodyState, RoomSnapshot, ClientInput, Vec3, Quat } from '@rapierphysicsplugin/shared';
import {
  RECONCILIATION_THRESHOLD,
  POSITION_LERP_SPEED,
  ROTATION_SLERP_SPEED,
} from '@rapierphysicsplugin/shared';
import { Interpolator } from './interpolator.js';

export interface ReconciliationResult {
  /** Bodies that the local client controls — apply corrections */
  localCorrections: Map<string, BodyState>;
  /** Bodies controlled by remote players — use interpolated states */
  remoteStates: Map<string, BodyState>;
}

export class StateReconciler {
  private interpolator: Interpolator;
  private localBodyIds: Set<string> = new Set();
  private pendingInputs: ClientInput[] = [];
  private lastServerTick = 0;

  constructor(interpolator?: Interpolator) {
    this.interpolator = interpolator ?? new Interpolator();
  }

  setLocalBodies(bodyIds: string[]): void {
    this.localBodyIds = new Set(bodyIds);
  }

  addLocalBody(bodyId: string): void {
    this.localBodyIds.add(bodyId);
  }

  removeLocalBody(bodyId: string): void {
    this.localBodyIds.delete(bodyId);
  }

  addPendingInput(input: ClientInput): void {
    this.pendingInputs.push(input);
  }

  processServerState(snapshot: RoomSnapshot): ReconciliationResult {
    const result: ReconciliationResult = {
      localCorrections: new Map(),
      remoteStates: new Map(),
    };

    this.lastServerTick = snapshot.tick;

    // Discard inputs that the server has already processed
    this.pendingInputs = this.pendingInputs.filter(
      input => input.tick > snapshot.tick
    );

    const currentTime = Date.now();

    for (const body of snapshot.bodies) {
      if (this.localBodyIds.has(body.id)) {
        // Local body — check if correction needed
        result.localCorrections.set(body.id, body);
      } else {
        // Remote body — feed to interpolator
        this.interpolator.addSnapshot(body.id, body, snapshot.timestamp);
        const interpolated = this.interpolator.getInterpolatedState(body.id, currentTime);
        if (interpolated) {
          result.remoteStates.set(body.id, interpolated);
        }
      }
    }

    return result;
  }

  getInterpolatedRemoteState(bodyId: string, currentTime: number): BodyState | null {
    return this.interpolator.getInterpolatedState(bodyId, currentTime);
  }

  getPendingInputs(): ClientInput[] {
    return this.pendingInputs;
  }

  get lastProcessedServerTick(): number {
    return this.lastServerTick;
  }

  getInterpolator(): Interpolator {
    return this.interpolator;
  }

  clear(): void {
    this.localBodyIds.clear();
    this.pendingInputs = [];
    this.interpolator.clear();
    this.lastServerTick = 0;
  }
}

export function needsCorrection(predicted: BodyState, authoritative: BodyState): boolean {
  const dx = predicted.position.x - authoritative.position.x;
  const dy = predicted.position.y - authoritative.position.y;
  const dz = predicted.position.z - authoritative.position.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  return distSq > RECONCILIATION_THRESHOLD * RECONCILIATION_THRESHOLD;
}

export function blendBodyState(current: BodyState, target: BodyState): BodyState {
  return {
    id: current.id,
    position: lerpVec3(current.position, target.position, POSITION_LERP_SPEED),
    rotation: slerpQuat(current.rotation, target.rotation, ROTATION_SLERP_SPEED),
    linVel: target.linVel,
    angVel: target.angVel,
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
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    const len = Math.sqrt(
      (a.x + (bx - a.x) * t) ** 2 +
      (a.y + (by - a.y) * t) ** 2 +
      (a.z + (bz - a.z) * t) ** 2 +
      (a.w + (bw - a.w) * t) ** 2
    );
    return {
      x: (a.x + (bx - a.x) * t) / len,
      y: (a.y + (by - a.y) * t) / len,
      z: (a.z + (bz - a.z) * t) / len,
      w: (a.w + (bw - a.w) * t) / len,
    };
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
