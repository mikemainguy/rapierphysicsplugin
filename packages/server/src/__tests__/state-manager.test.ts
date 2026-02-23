import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics-world.js';
import { StateManager } from '../state-manager.js';
import type { BodyDescriptor } from '@havokserver/shared';

describe('StateManager', () => {
  let world: PhysicsWorld;
  let stateManager: StateManager;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new PhysicsWorld(RAPIER);
    stateManager = new StateManager();
  });

  afterEach(() => {
    world.destroy();
  });

  function makeBox(id: string, y: number = 5): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
      motionType: 'dynamic',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      mass: 1.0,
    };
  }

  it('should create a full snapshot', () => {
    world.addBody(makeBox('box1', 5));
    world.addBody(makeBox('box2', 10));

    const snapshot = stateManager.createSnapshot(world, 42);
    expect(snapshot.tick).toBe(42);
    expect(snapshot.bodies).toHaveLength(2);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it('should create delta with all bodies on first call', () => {
    world.addBody(makeBox('box1', 5));
    const delta = stateManager.createDelta(world, 1);
    expect(delta.bodies).toHaveLength(1);
  });

  it('should create empty delta when nothing changed', () => {
    world.addBody(makeBox('box1', 5));

    // First delta includes everything
    stateManager.createDelta(world, 1);

    // No stepping, nothing changed — delta should be empty
    const delta2 = stateManager.createDelta(world, 2);
    expect(delta2.bodies).toHaveLength(0);
  });

  it('should detect changes after physics step', () => {
    world.addBody(makeBox('box1', 5));

    // First delta
    stateManager.createDelta(world, 1);

    // Step physics — body should fall
    for (let i = 0; i < 10; i++) {
      world.step();
    }

    const delta2 = stateManager.createDelta(world, 2);
    expect(delta2.bodies).toHaveLength(1);
    expect(delta2.bodies[0].id).toBe('box1');
  });
});
