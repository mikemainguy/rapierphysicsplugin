import { describe, it, expect, beforeEach } from 'vitest';
import { StateReconciler, needsCorrection, blendBodyState } from '../state-reconciler.js';
import type { BodyState, RoomSnapshot } from '@rapierphysicsplugin/shared';

function makeState(id: string, x: number, y: number, z: number): BodyState {
  return {
    id,
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linVel: { x: 0, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 },
  };
}

describe('StateReconciler', () => {
  let reconciler: StateReconciler;

  beforeEach(() => {
    reconciler = new StateReconciler();
  });

  it('should separate local and remote bodies', () => {
    reconciler.addLocalBody('player1');

    const snapshot: RoomSnapshot = {
      tick: 10,
      timestamp: Date.now(),
      bodies: [
        makeState('player1', 1, 2, 3),
        makeState('enemy1', 4, 5, 6),
      ],
    };

    const result = reconciler.processServerState(snapshot);
    expect(result.localCorrections.has('player1')).toBe(true);
    expect(result.remoteStates.has('enemy1')).toBe(true);
  });

  it('should discard old pending inputs', () => {
    reconciler.addPendingInput({ tick: 5, sequenceNum: 0, actions: [] });
    reconciler.addPendingInput({ tick: 10, sequenceNum: 1, actions: [] });
    reconciler.addPendingInput({ tick: 15, sequenceNum: 2, actions: [] });

    reconciler.processServerState({
      tick: 10,
      timestamp: Date.now(),
      bodies: [],
    });

    const pending = reconciler.getPendingInputs();
    expect(pending).toHaveLength(1);
    expect(pending[0].tick).toBe(15);
  });

  it('should track last server tick', () => {
    reconciler.processServerState({
      tick: 42,
      timestamp: Date.now(),
      bodies: [],
    });
    expect(reconciler.lastProcessedServerTick).toBe(42);
  });

  it('should clear all state', () => {
    reconciler.addLocalBody('player1');
    reconciler.addPendingInput({ tick: 5, sequenceNum: 0, actions: [] });
    reconciler.clear();

    expect(reconciler.getPendingInputs()).toHaveLength(0);
    expect(reconciler.lastProcessedServerTick).toBe(0);
  });
});

describe('needsCorrection', () => {
  it('should return false for small differences', () => {
    const a = makeState('body1', 1, 2, 3);
    const b = makeState('body1', 1.01, 2.01, 3.01);
    expect(needsCorrection(a, b)).toBe(false);
  });

  it('should return true for large differences', () => {
    const a = makeState('body1', 1, 2, 3);
    const b = makeState('body1', 2, 2, 3);
    expect(needsCorrection(a, b)).toBe(true);
  });
});

describe('blendBodyState', () => {
  it('should blend positions toward target', () => {
    const current = makeState('body1', 0, 0, 0);
    const target = makeState('body1', 10, 0, 0);

    const blended = blendBodyState(current, target);
    expect(blended.position.x).toBeGreaterThan(0);
    expect(blended.position.x).toBeLessThan(10);
  });
});
