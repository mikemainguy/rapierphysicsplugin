import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RapierPluginState } from '../types.js';
import { processCollisionEvents, injectCollisionEvents } from '../collision-ops.js';

// --- Mocks ---

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    negate() { return new Vector3(-this.x, -this.y, -this.z); }
  }
  const PhysicsEventType = {
    COLLISION_STARTED: 0,
    COLLISION_CONTINUED: 1,
    COLLISION_FINISHED: 2,
    TRIGGER_ENTERED: 3,
    TRIGGER_EXITED: 4,
  };
  return { Vector3, PhysicsEventType };
});

vi.mock('@rapierphysicsplugin/shared', () => ({}));

// --- Helpers ---

function makeObservable() {
  return { notifyObservers: vi.fn() };
}

function makeState(overrides: Partial<RapierPluginState> = {}): RapierPluginState {
  return {
    world: {
      getCollider: vi.fn((h: number) => makeCollider(h)),
      contactPair: vi.fn(),
    } as any,
    colliderHandleToBody: new Map(),
    bodyIdToPhysicsBody: new Map(),
    collisionCallbackEnabled: new Set(),
    collisionEndedCallbackEnabled: new Set(),
    bodyCollisionObservables: new Map(),
    bodyCollisionEndedObservables: new Map(),
    activeCollisionPairs: new Set(),
    onCollisionObservable: makeObservable() as any,
    onCollisionEndedObservable: makeObservable() as any,
    onTriggerCollisionObservable: makeObservable() as any,
    ...overrides,
  } as any;
}

function makeCollider(handle: number, sensor = false) {
  return {
    handle,
    isSensor: vi.fn(() => sensor),
    translation: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  };
}

function makeEventQueue(events: Array<[number, number, boolean]>) {
  return {
    drainCollisionEvents: vi.fn((cb: (h1: number, h2: number, started: boolean) => void) => {
      for (const [h1, h2, started] of events) cb(h1, h2, started);
    }),
  } as any;
}

// --- Tests ---

describe('collision-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processCollisionEvents', () => {
    describe('collision started (non-sensor)', () => {
      it('notifies onCollisionObservable with COLLISION_STARTED', () => {
        const body1 = { id: 'b1' } as any;
        const body2 = { id: 'b2' } as any;
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);

        const eq = makeEventQueue([[1, 2, true]]);
        processCollisionEvents(state, eq);

        expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
        const event = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.collider).toBe(body1);
        expect(event.collidedAgainst).toBe(body2);
        expect(event.type).toBe(0); // COLLISION_STARTED
      });

      it('adds pair to activeCollisionPairs', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(state.activeCollisionPairs.has('1_2')).toBe(true);
      });

      it('notifies per-body observers when callback enabled', () => {
        const body1 = { id: 'b1' } as any;
        const body2 = { id: 'b2' } as any;
        const obs1 = makeObservable();
        const obs2 = makeObservable();
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);
        state.collisionCallbackEnabled.add(body1);
        state.collisionCallbackEnabled.add(body2);
        state.bodyCollisionObservables.set(body1, obs1 as any);
        state.bodyCollisionObservables.set(body2, obs2 as any);

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(obs1.notifyObservers).toHaveBeenCalledOnce();
        expect(obs2.notifyObservers).toHaveBeenCalledOnce();
        // body2's event should have body2 as collider
        const ev2 = obs2.notifyObservers.mock.calls[0][0];
        expect(ev2.collider).toBe(body2);
        expect(ev2.collidedAgainst).toBe(body1);
      });

      it('extracts contact point and normal from contactPair', () => {
        const body1 = {} as any;
        const body2 = {} as any;
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);

        (state.world.contactPair as any).mockImplementation(
          (_c1: any, _c2: any, cb: (manifold: any, flipped: boolean) => void) => {
            cb({
              normal: () => ({ x: 0, y: 1, z: 0 }),
              numContacts: () => 1,
              localContactPoint1: () => ({ x: 1, y: 2, z: 3 }),
              contactImpulse: () => 42,
            }, false);
          },
        );

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        const event = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.normal).toEqual({ x: 0, y: 1, z: 0 });
        expect(event.point).toEqual({ x: 1, y: 2, z: 3 }); // cp + translation(0,0,0)
        expect(event.impulse).toBe(42);
      });

      it('flips normal when contactPair reports flipped', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);

        (state.world.contactPair as any).mockImplementation(
          (_c1: any, _c2: any, cb: (m: any, f: boolean) => void) => {
            cb({
              normal: () => ({ x: 1, y: 0, z: 0 }),
              numContacts: () => 0,
            }, true);
          },
        );

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        const event = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.normal).toEqual({ x: -1, y: -0, z: -0 });
      });
    });

    describe('collision finished (non-sensor)', () => {
      it('notifies onCollisionEndedObservable', () => {
        const body1 = {} as any;
        const body2 = {} as any;
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);
        state.activeCollisionPairs.add('1_2');

        processCollisionEvents(state, makeEventQueue([[1, 2, false]]));

        expect(state.onCollisionEndedObservable.notifyObservers).toHaveBeenCalledOnce();
        const event = (state.onCollisionEndedObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.type).toBe(2); // COLLISION_FINISHED
      });

      it('removes pair from activeCollisionPairs', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);
        state.activeCollisionPairs.add('1_2');

        processCollisionEvents(state, makeEventQueue([[1, 2, false]]));

        expect(state.activeCollisionPairs.has('1_2')).toBe(false);
      });

      it('notifies per-body ended observers when enabled', () => {
        const body1 = {} as any;
        const body2 = {} as any;
        const obs1 = makeObservable();
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);
        state.collisionEndedCallbackEnabled.add(body1);
        state.bodyCollisionEndedObservables.set(body1, obs1 as any);

        processCollisionEvents(state, makeEventQueue([[1, 2, false]]));

        expect(obs1.notifyObservers).toHaveBeenCalledOnce();
      });
    });

    describe('sensor / trigger events', () => {
      it('notifies onTriggerCollisionObservable for sensor started', () => {
        const body1 = {} as any;
        const body2 = {} as any;
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);

        // Make collider 1 a sensor
        (state.world.getCollider as any).mockImplementation((h: number) =>
          makeCollider(h, h === 1),
        );

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(state.onTriggerCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
        const event = (state.onTriggerCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.type).toBe(3); // TRIGGER_ENTERED
      });

      it('emits TRIGGER_EXITED when sensor collision ends', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);
        (state.world.getCollider as any).mockImplementation((h: number) =>
          makeCollider(h, h === 2),
        );

        processCollisionEvents(state, makeEventQueue([[1, 2, false]]));

        const event = (state.onTriggerCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.type).toBe(4); // TRIGGER_EXITED
      });

      it('notifies per-body trigger observers when callback enabled', () => {
        const body1 = {} as any;
        const obs1 = makeObservable();
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, {} as any);
        state.collisionCallbackEnabled.add(body1);
        state.bodyCollisionObservables.set(body1, obs1 as any);
        (state.world.getCollider as any).mockImplementation((h: number) =>
          makeCollider(h, true),
        );

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(obs1.notifyObservers).toHaveBeenCalledOnce();
        const ev = obs1.notifyObservers.mock.calls[0][0];
        expect(ev.point).toBeNull();
        expect(ev.impulse).toBe(0);
      });
    });

    describe('collision continued', () => {
      it('emits COLLISION_CONTINUED for active pairs with no event this frame', () => {
        const body1 = {} as any;
        const body2 = {} as any;
        const state = makeState();
        state.colliderHandleToBody.set(1, body1);
        state.colliderHandleToBody.set(2, body2);
        state.activeCollisionPairs.add('1_2');

        // No events this frame
        processCollisionEvents(state, makeEventQueue([]));

        expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
        const event = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
        expect(event.type).toBe(1); // COLLISION_CONTINUED
      });

      it('does not emit CONTINUED for pairs that had an event this frame', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);
        state.activeCollisionPairs.add('1_2');

        // Pair fires a started event this frame (re-started)
        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        // Only the STARTED event, no CONTINUED
        expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
      });

      it('skips CONTINUED if bodies no longer exist', () => {
        const state = makeState();
        state.activeCollisionPairs.add('1_2');
        // No bodies mapped for handles 1, 2

        processCollisionEvents(state, makeEventQueue([]));

        expect(state.onCollisionObservable.notifyObservers).not.toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('skips events when body not found for handle', () => {
        const state = makeState();
        // Only body1 exists
        state.colliderHandleToBody.set(1, {} as any);

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(state.onCollisionObservable.notifyObservers).not.toHaveBeenCalled();
      });

      it('skips events when collider not found', () => {
        const state = makeState();
        state.colliderHandleToBody.set(1, {} as any);
        state.colliderHandleToBody.set(2, {} as any);
        (state.world.getCollider as any).mockReturnValue(null);

        processCollisionEvents(state, makeEventQueue([[1, 2, true]]));

        expect(state.onCollisionObservable.notifyObservers).not.toHaveBeenCalled();
      });

      it('handles pair key ordering (smaller handle first)', () => {
        const state = makeState();
        state.colliderHandleToBody.set(5, {} as any);
        state.colliderHandleToBody.set(3, {} as any);

        processCollisionEvents(state, makeEventQueue([[5, 3, true]]));

        expect(state.activeCollisionPairs.has('3_5')).toBe(true);
      });
    });
  });

  describe('injectCollisionEvents', () => {
    it('injects COLLISION_STARTED events', () => {
      const bodyA = {} as any;
      const bodyB = {} as any;
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', bodyA);
      state.bodyIdToPhysicsBody.set('b', bodyB);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_STARTED',
        point: { x: 1, y: 2, z: 3 },
        normal: { x: 0, y: 1, z: 0 },
        impulse: 5,
      } as any]);

      expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
      const ev = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
      expect(ev.collider).toBe(bodyA);
      expect(ev.point).toEqual({ x: 1, y: 2, z: 3 });
      expect(ev.impulse).toBe(5);
    });

    it('injects COLLISION_CONTINUED events', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_CONTINUED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
    });

    it('injects COLLISION_FINISHED events', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_FINISHED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(state.onCollisionEndedObservable.notifyObservers).toHaveBeenCalledOnce();
    });

    it('injects TRIGGER_ENTERED events', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'TRIGGER_ENTERED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(state.onTriggerCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
    });

    it('injects TRIGGER_EXITED events', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'TRIGGER_EXITED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(state.onTriggerCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
    });

    it('skips events when bodyA not found', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'missing',
        bodyIdB: 'b',
        type: 'COLLISION_STARTED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(state.onCollisionObservable.notifyObservers).not.toHaveBeenCalled();
    });

    it('notifies per-body observers for injected collision events', () => {
      const bodyA = {} as any;
      const bodyB = {} as any;
      const obsA = makeObservable();
      const obsB = makeObservable();
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', bodyA);
      state.bodyIdToPhysicsBody.set('b', bodyB);
      state.collisionCallbackEnabled.add(bodyA);
      state.collisionCallbackEnabled.add(bodyB);
      state.bodyCollisionObservables.set(bodyA, obsA as any);
      state.bodyCollisionObservables.set(bodyB, obsB as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_STARTED',
        point: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        impulse: 1,
      } as any]);

      expect(obsA.notifyObservers).toHaveBeenCalledOnce();
      expect(obsB.notifyObservers).toHaveBeenCalledOnce();
      // B's event should have negated normal
      const evB = obsB.notifyObservers.mock.calls[0][0];
      expect(evB.normal).toEqual({ x: -0, y: -1, z: -0 });
    });

    it('notifies per-body ended observers for COLLISION_FINISHED', () => {
      const bodyA = {} as any;
      const obsA = makeObservable();
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', bodyA);
      state.bodyIdToPhysicsBody.set('b', {} as any);
      state.collisionEndedCallbackEnabled.add(bodyA);
      state.bodyCollisionEndedObservables.set(bodyA, obsA as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_FINISHED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(obsA.notifyObservers).toHaveBeenCalledOnce();
    });

    it('notifies per-body trigger observers for TRIGGER_ENTERED', () => {
      const bodyA = {} as any;
      const obsA = makeObservable();
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', bodyA);
      state.bodyIdToPhysicsBody.set('b', {} as any);
      state.collisionCallbackEnabled.add(bodyA);
      state.bodyCollisionObservables.set(bodyA, obsA as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'TRIGGER_ENTERED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      expect(obsA.notifyObservers).toHaveBeenCalledOnce();
      const ev = obsA.notifyObservers.mock.calls[0][0];
      expect(ev.point).toBeNull();
      expect(ev.impulse).toBe(0);
    });

    it('handles multiple events in a single call', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [
        { bodyIdA: 'a', bodyIdB: 'b', type: 'COLLISION_STARTED', point: null, normal: null, impulse: 0 },
        { bodyIdA: 'a', bodyIdB: 'b', type: 'COLLISION_FINISHED', point: null, normal: null, impulse: 0 },
      ] as any);

      expect(state.onCollisionObservable.notifyObservers).toHaveBeenCalledOnce();
      expect(state.onCollisionEndedObservable.notifyObservers).toHaveBeenCalledOnce();
    });

    it('handles null point and normal gracefully', () => {
      const state = makeState();
      state.bodyIdToPhysicsBody.set('a', {} as any);
      state.bodyIdToPhysicsBody.set('b', {} as any);

      injectCollisionEvents(state, [{
        bodyIdA: 'a',
        bodyIdB: 'b',
        type: 'COLLISION_STARTED',
        point: null,
        normal: null,
        impulse: 0,
      } as any]);

      const ev = (state.onCollisionObservable.notifyObservers as any).mock.calls[0][0];
      expect(ev.point).toBeNull();
      expect(ev.normal).toBeNull();
    });
  });
});
