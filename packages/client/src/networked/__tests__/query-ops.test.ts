import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NetworkedPluginState } from '../types.js';
import {
  applyForce,
  applyImpulse,
  applyAngularImpulse,
  applyTorque,
  setLinearVelocity,
  setAngularVelocity,
  setTargetTransform,
  shapeCastAsync,
  shapeProximityAsync,
  pointProximityAsync,
} from '../query-ops.js';

// --- Helpers ---

function makeState(overrides: Partial<NetworkedPluginState> = {}): NetworkedPluginState {
  return {
    bodyToId: new Map(),
    idToBody: new Map(),
    syncClient: {
      sendInput: vi.fn(),
      shapeCastQuery: vi.fn(),
      shapeProximityQuery: vi.fn(),
      pointProximityQuery: vi.fn(),
    } as any,
    ...overrides,
  } as any;
}

function v3(x: number, y: number, z: number) {
  return { x, y, z } as any;
}

function quat(x = 0, y = 0, z = 0, w = 1) {
  return { x, y, z, w } as any;
}

// --- Tests ---

describe('query-ops (networked)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('input actions', () => {
    const actions = [
      { fn: applyForce, name: 'applyForce', args: [v3(1, 0, 0), v3(0, 1, 0)], type: 'applyForce' },
      { fn: applyImpulse, name: 'applyImpulse', args: [v3(1, 0, 0), v3(0, 1, 0)], type: 'applyImpulse' },
      { fn: applyAngularImpulse, name: 'applyAngularImpulse', args: [v3(1, 2, 3)], type: 'applyAngularImpulse' },
      { fn: applyTorque, name: 'applyTorque', args: [v3(1, 2, 3)], type: 'applyTorque' },
      { fn: setLinearVelocity, name: 'setLinearVelocity', args: [v3(1, 2, 3)], type: 'setVelocity' },
      { fn: setAngularVelocity, name: 'setAngularVelocity', args: [v3(1, 2, 3)], type: 'setAngularVelocity' },
    ];

    for (const { fn, name, args, type } of actions) {
      it(`${name} sends input when body is registered`, () => {
        const state = makeState();
        const body = {} as any;
        state.bodyToId.set(body, 'b1');

        (fn as any)(state, body, ...args);

        expect(state.syncClient.sendInput).toHaveBeenCalledTimes(1);
        const sent = (state.syncClient.sendInput as any).mock.calls[0][0];
        expect(sent[0].type).toBe(type);
        expect(sent[0].bodyId).toBe('b1');
      });

      it(`${name} does nothing when body not registered`, () => {
        const state = makeState();
        (fn as any)(state, {} as any, ...args);
        expect(state.syncClient.sendInput).not.toHaveBeenCalled();
      });
    }
  });

  describe('setTargetTransform', () => {
    it('sends setPosition and setRotation inputs', () => {
      const state = makeState();
      const body = {} as any;
      state.bodyToId.set(body, 'b1');

      setTargetTransform(state, body, v3(1, 2, 3), quat(0, 0, 0, 1));

      expect(state.syncClient.sendInput).toHaveBeenCalledTimes(1);
      const sent = (state.syncClient.sendInput as any).mock.calls[0][0];
      expect(sent).toHaveLength(2);
      expect(sent[0].type).toBe('setPosition');
      expect(sent[1].type).toBe('setRotation');
    });

    it('does nothing when body not registered', () => {
      const state = makeState();
      setTargetTransform(state, {} as any, v3(0, 0, 0), quat());
      expect(state.syncClient.sendInput).not.toHaveBeenCalled();
    });
  });

  describe('shapeCastAsync', () => {
    it('returns response with hitBody resolved from idToBody', async () => {
      const state = makeState();
      const hitBody = {} as any;
      state.idToBody.set('hit-1', hitBody);

      (state.syncClient.shapeCastQuery as any).mockResolvedValue({
        hit: true,
        hitBodyId: 'hit-1',
        fraction: 0.5,
      });

      const result = await shapeCastAsync(state, {} as any, v3(0, 0, 0), v3(0, 10, 0), quat());

      expect(result.hit).toBe(true);
      expect(result.hitBody).toBe(hitBody);
    });

    it('returns undefined hitBody when no hitBodyId', async () => {
      const state = makeState();
      (state.syncClient.shapeCastQuery as any).mockResolvedValue({ hit: false });

      const result = await shapeCastAsync(state, {} as any, v3(0, 0, 0), v3(0, 10, 0), quat());

      expect(result.hitBody).toBeUndefined();
    });
  });

  describe('shapeProximityAsync', () => {
    it('returns response with hitBody resolved', async () => {
      const state = makeState();
      const hitBody = {} as any;
      state.idToBody.set('h1', hitBody);

      (state.syncClient.shapeProximityQuery as any).mockResolvedValue({
        hit: true,
        hitBodyId: 'h1',
        distance: 2,
      });

      const result = await shapeProximityAsync(state, {} as any, v3(0, 0, 0), quat(), 10);

      expect(result.hitBody).toBe(hitBody);
    });

    it('passes ignoreBodyId through', async () => {
      const state = makeState();
      (state.syncClient.shapeProximityQuery as any).mockResolvedValue({ hit: false });

      await shapeProximityAsync(state, {} as any, v3(0, 0, 0), quat(), 10, 'ignore-1');

      expect(state.syncClient.shapeProximityQuery).toHaveBeenCalledWith({} as any, v3(0, 0, 0), quat(), 10, 'ignore-1');
    });
  });

  describe('pointProximityAsync', () => {
    it('returns response with hitBody resolved', async () => {
      const state = makeState();
      const hitBody = {} as any;
      state.idToBody.set('p1', hitBody);

      (state.syncClient.pointProximityQuery as any).mockResolvedValue({
        hit: true,
        hitBodyId: 'p1',
        distance: 1,
      });

      const result = await pointProximityAsync(state, v3(0, 0, 0), 10);

      expect(result.hitBody).toBe(hitBody);
    });

    it('returns undefined hitBody when hitBodyId not in map', async () => {
      const state = makeState();
      (state.syncClient.pointProximityQuery as any).mockResolvedValue({
        hit: true,
        hitBodyId: 'unknown',
      });

      const result = await pointProximityAsync(state, v3(0, 0, 0), 10);

      expect(result.hitBody).toBeUndefined();
    });
  });
});
