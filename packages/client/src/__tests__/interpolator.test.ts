import { describe, it, expect, beforeEach } from 'vitest';
import { Interpolator } from '../interpolator.js';
import type { BodyState } from '@rapierphysicsplugin/shared';

function makeState(id: string, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): BodyState {
  return {
    id,
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linVel: { x: vx, y: vy, z: vz },
    angVel: { x: 0, y: 0, z: 0 },
  };
}

describe('Interpolator', () => {
  let interpolator: Interpolator;

  beforeEach(() => {
    // Use 0ms render delay for deterministic testing
    interpolator = new Interpolator(0);
  });

  it('should return null for unknown bodies', () => {
    expect(interpolator.getInterpolatedState('unknown', Date.now())).toBeNull();
  });

  it('should return earliest state when render time is before all snapshots', () => {
    interpolator.addSnapshot('body1', makeState('body1', 0, 0, 0), 1000);
    interpolator.addSnapshot('body1', makeState('body1', 10, 0, 0), 2000);

    const state = interpolator.getInterpolatedState('body1', 500);
    expect(state).not.toBeNull();
    expect(state!.position.x).toBeCloseTo(0);
  });

  it('should interpolate between two snapshots', () => {
    interpolator.addSnapshot('body1', makeState('body1', 0, 0, 0), 1000);
    interpolator.addSnapshot('body1', makeState('body1', 10, 0, 0), 2000);

    // Midpoint
    const state = interpolator.getInterpolatedState('body1', 1500);
    expect(state).not.toBeNull();
    // Hermite interpolation at t=0.5 with zero velocities should give midpoint
    expect(state!.position.x).toBeCloseTo(5, 0);
  });

  it('should extrapolate after last snapshot', () => {
    interpolator.addSnapshot('body1', makeState('body1', 0, 0, 0, 10, 0, 0), 1000);

    // 0.1 seconds after the last snapshot
    const state = interpolator.getInterpolatedState('body1', 1100);
    expect(state).not.toBeNull();
    // Should move in the x direction due to velocity
    expect(state!.position.x).toBeGreaterThan(0);
  });

  it('should interpolate rotation via slerp', () => {
    const state1: BodyState = {
      id: 'body1',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, // identity
      linVel: { x: 0, y: 0, z: 0 },
      angVel: { x: 0, y: 0, z: 0 },
    };
    const state2: BodyState = {
      id: 'body1',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0.7071, z: 0, w: 0.7071 }, // 90deg around Y
      linVel: { x: 0, y: 0, z: 0 },
      angVel: { x: 0, y: 0, z: 0 },
    };

    interpolator.addSnapshot('body1', state1, 1000);
    interpolator.addSnapshot('body1', state2, 2000);

    const result = interpolator.getInterpolatedState('body1', 1500);
    expect(result).not.toBeNull();

    // Quaternion magnitude should be ~1
    const q = result!.rotation;
    const mag = Math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2);
    expect(mag).toBeCloseTo(1, 2);
  });

  it('should remove a body', () => {
    interpolator.addSnapshot('body1', makeState('body1', 0, 0, 0), 1000);
    interpolator.removeBody('body1');
    expect(interpolator.getInterpolatedState('body1', 1000)).toBeNull();
  });

  it('should clear all data', () => {
    interpolator.addSnapshot('body1', makeState('body1', 0, 0, 0), 1000);
    interpolator.addSnapshot('body2', makeState('body2', 5, 5, 5), 1000);
    interpolator.clear();
    expect(interpolator.getInterpolatedState('body1', 1000)).toBeNull();
    expect(interpolator.getInterpolatedState('body2', 1000)).toBeNull();
  });
});
