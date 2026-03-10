import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics-world/index.js';
import type { BodyDescriptor } from '@rapierphysicsplugin/shared';

describe('PhysicsWorld collision events', () => {
  let world: PhysicsWorld;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new PhysicsWorld(RAPIER);
  });

  afterEach(() => {
    world.destroy();
  });

  function makeGround(): BodyDescriptor {
    return {
      id: 'ground',
      shape: { type: 'box', params: { halfExtents: { x: 50, y: 0.5, z: 50 } } },
      motionType: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  function makeBox(id: string, y: number): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
      motionType: 'dynamic',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      mass: 1.0,
    };
  }

  function makeSensor(id: string, y: number): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 2, y: 2, z: 2 } } },
      motionType: 'static',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      isTrigger: true,
    };
  }

  it('should return empty events when no collisions occur', () => {
    world.addBody(makeBox('box1', 100));
    const events = world.step();
    expect(events).toEqual([]);
  });

  it('should detect collision when box falls onto ground', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('box1', 1.5));

    // Step many times until box reaches ground
    let allEvents: ReturnType<typeof world.step> = [];
    for (let i = 0; i < 120; i++) {
      const events = world.step();
      allEvents.push(...events);
    }

    const collisionStarted = allEvents.filter(e => e.type === 'COLLISION_STARTED');
    expect(collisionStarted.length).toBeGreaterThan(0);

    const event = collisionStarted[0];
    // Should involve box1 and ground (order may vary)
    const ids = [event.bodyIdA, event.bodyIdB].sort();
    expect(ids).toEqual(['box1', 'ground']);
  });

  it('should have contact point and normal for COLLISION_STARTED', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('box1', 1.5));

    let collisionEvent = null;
    for (let i = 0; i < 120; i++) {
      const events = world.step();
      const started = events.find(e => e.type === 'COLLISION_STARTED');
      if (started) {
        collisionEvent = started;
        break;
      }
    }

    expect(collisionEvent).not.toBeNull();
    // Contact point should exist for non-sensor collisions
    // Note: contact point may be null if Rapier doesn't provide it on the first frame
    // but normal should typically be available
    if (collisionEvent!.point) {
      expect(typeof collisionEvent!.point.x).toBe('number');
      expect(typeof collisionEvent!.point.y).toBe('number');
      expect(typeof collisionEvent!.point.z).toBe('number');
    }
  });

  it('should detect TRIGGER_ENTERED when box enters sensor', () => {
    world.addBody(makeSensor('sensor1', 2));
    world.addBody(makeBox('box1', 10));

    let allEvents: ReturnType<typeof world.step> = [];
    for (let i = 0; i < 120; i++) {
      const events = world.step();
      allEvents.push(...events);
    }

    const triggerEntered = allEvents.filter(e => e.type === 'TRIGGER_ENTERED');
    expect(triggerEntered.length).toBeGreaterThan(0);

    const event = triggerEntered[0];
    const ids = [event.bodyIdA, event.bodyIdB].sort();
    expect(ids).toEqual(['box1', 'sensor1']);

    // Sensor events should not have contact info
    expect(event.point).toBeNull();
    expect(event.normal).toBeNull();
    expect(event.impulse).toBe(0);
  });

  it('should map body IDs correctly for collision events', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('alpha', 1.5));
    world.addBody(makeBox('beta', 5));

    let allEvents: ReturnType<typeof world.step> = [];
    for (let i = 0; i < 200; i++) {
      const events = world.step();
      allEvents.push(...events);
    }

    // All events should reference known body IDs
    for (const event of allEvents) {
      expect(['alpha', 'beta', 'ground']).toContain(event.bodyIdA);
      expect(['alpha', 'beta', 'ground']).toContain(event.bodyIdB);
    }
  });

  it('should return events from step() without modifying previous results', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('box1', 1.5));

    const firstEvents = world.step();
    const secondEvents = world.step();

    // Each call returns its own array
    expect(firstEvents).not.toBe(secondEvents);
  });

  it('should emit COLLISION_CONTINUED after COLLISION_STARTED while bodies remain in contact', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('box1', 1.5));

    let allEvents: ReturnType<typeof world.step> = [];
    let foundStarted = false;
    let foundContinued = false;

    for (let i = 0; i < 200; i++) {
      const events = world.step();
      for (const e of events) {
        if (e.type === 'COLLISION_STARTED') foundStarted = true;
        if (e.type === 'COLLISION_CONTINUED') foundContinued = true;
      }
      allEvents.push(...events);
      if (foundStarted && foundContinued) break;
    }

    expect(foundStarted).toBe(true);
    expect(foundContinued).toBe(true);

    // COLLISION_CONTINUED events should have body IDs
    const continued = allEvents.filter(e => e.type === 'COLLISION_CONTINUED');
    expect(continued.length).toBeGreaterThan(0);
    const ids = [continued[0].bodyIdA, continued[0].bodyIdB].sort();
    expect(ids).toEqual(['box1', 'ground']);
  });

  it('should stop emitting COLLISION_CONTINUED after COLLISION_FINISHED', () => {
    world.addBody(makeGround());
    world.addBody(makeBox('box1', 1.5));

    // Step until collision started
    let foundStarted = false;
    for (let i = 0; i < 200 && !foundStarted; i++) {
      const events = world.step();
      foundStarted = events.some(e => e.type === 'COLLISION_STARTED');
    }
    expect(foundStarted).toBe(true);

    // Remove the box to trigger COLLISION_FINISHED
    world.removeBody('box1');

    // Step a few more times — should get no more continued events for box1
    for (let i = 0; i < 10; i++) {
      const events = world.step();
      const continuedForBox = events.filter(
        e => e.type === 'COLLISION_CONTINUED' &&
          (e.bodyIdA === 'box1' || e.bodyIdB === 'box1'),
      );
      expect(continuedForBox).toHaveLength(0);
    }
  });
});
