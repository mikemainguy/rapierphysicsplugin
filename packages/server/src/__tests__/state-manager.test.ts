import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics-world.js';
import { StateManager } from '../state-manager.js';
import type { BodyDescriptor } from '@rapierphysicsplugin/shared';
import { FIELD_POSITION, FIELD_ROTATION, FIELD_LIN_VEL, FIELD_ANG_VEL, FIELD_ALL } from '@rapierphysicsplugin/shared';

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

  function makeStaticBox(id: string, y: number = 0): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 5, y: 0.5, z: 5 } } },
      motionType: 'static',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
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

  it('should create delta with all bodies on first call (fieldMask = FIELD_ALL)', () => {
    world.addBody(makeBox('box1', 5));
    const delta = stateManager.createDelta(world, 1);
    expect(delta.bodies).toHaveLength(1);
    expect(delta.bodies[0].fieldMask).toBe(FIELD_ALL);
    expect(delta.isDelta).toBe(true);
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

  it('should set per-field mask for position+linVel change (falling body)', () => {
    world.addBody(makeBox('box1', 5));

    // First delta
    stateManager.createDelta(world, 1);

    // Step physics — body falls (position and linVel change, rotation stays identity)
    for (let i = 0; i < 10; i++) {
      world.step();
    }

    const delta2 = stateManager.createDelta(world, 2);
    expect(delta2.bodies).toHaveLength(1);
    const mask = delta2.bodies[0].fieldMask!;
    // A falling body should have position and linVel changed
    expect(mask & FIELD_POSITION).toBeTruthy();
    expect(mask & FIELD_LIN_VEL).toBeTruthy();
  });

  it('should assign body indices', () => {
    world.addBody(makeBox('box1', 5));
    world.addBody(makeBox('box2', 10));

    stateManager.createSnapshot(world, 0);

    expect(stateManager.getBodyIndex('box1')).toBe(0);
    expect(stateManager.getBodyIndex('box2')).toBe(1);
  });

  it('should produce ID mapping record', () => {
    world.addBody(makeBox('box1', 5));
    world.addBody(makeBox('box2', 10));
    stateManager.createSnapshot(world, 0);

    const record = stateManager.getIdToIndexRecord();
    expect(record).toEqual({ box1: 0, box2: 1 });
  });

  it('should keep index after body removal (indices are never reused)', () => {
    world.addBody(makeBox('box1', 5));
    world.addBody(makeBox('box2', 10));
    stateManager.createSnapshot(world, 0);

    stateManager.removeBody('box1');
    // box1 index is still in the map (not reused)
    expect(stateManager.getBodyIndex('box1')).toBe(0);

    // Adding a new body gets the next index
    world.addBody(makeBox('box3', 15));
    stateManager.ensureBodyIndex('box3');
    expect(stateManager.getBodyIndex('box3')).toBe(2);
  });

  it('should clear all state on clear()', () => {
    world.addBody(makeBox('box1', 5));
    stateManager.createSnapshot(world, 0);

    stateManager.clear();
    expect(stateManager.getBodyIndex('box1')).toBeUndefined();
    expect(stateManager.getIdToIndexRecord()).toEqual({});
  });
});
