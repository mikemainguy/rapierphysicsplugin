import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics-world.js';
import type { BodyDescriptor } from '@havokserver/shared';

describe('PhysicsWorld', () => {
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

  it('should add a body', () => {
    const id = world.addBody(makeBox('box1'));
    expect(id).toBe('box1');
    expect(world.bodyCount).toBe(1);
    expect(world.hasBody('box1')).toBe(true);
  });

  it('should throw when adding duplicate body', () => {
    world.addBody(makeBox('box1'));
    expect(() => world.addBody(makeBox('box1'))).toThrow('already exists');
  });

  it('should remove a body', () => {
    world.addBody(makeBox('box1'));
    world.removeBody('box1');
    expect(world.bodyCount).toBe(0);
    expect(world.hasBody('box1')).toBe(false);
  });

  it('should get body state', () => {
    world.addBody(makeBox('box1', 10));
    const state = world.getBodyState('box1');
    expect(state).not.toBeNull();
    expect(state!.id).toBe('box1');
    expect(state!.position.y).toBeCloseTo(10);
    expect(state!.rotation.w).toBeCloseTo(1);
  });

  it('should return null for non-existent body', () => {
    expect(world.getBodyState('nonexistent')).toBeNull();
  });

  it('should step the physics world', () => {
    world.addBody(makeBox('box1', 10));
    const stateBefore = world.getBodyState('box1')!;

    // Step multiple times so gravity takes effect
    for (let i = 0; i < 60; i++) {
      world.step();
    }

    const stateAfter = world.getBodyState('box1')!;
    // Box should have fallen due to gravity
    expect(stateAfter.position.y).toBeLessThan(stateBefore.position.y);
  });

  it('should get snapshot of all bodies', () => {
    world.addBody(makeBox('box1', 5));
    world.addBody(makeBox('box2', 10));

    const snapshot = world.getSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.map(s => s.id).sort()).toEqual(['box1', 'box2']);
  });

  it('should apply force to a body', () => {
    world.addBody(makeBox('box1', 5));
    world.applyForce('box1', { x: 0, y: 100, z: 0 });
    world.step();

    const state = world.getBodyState('box1')!;
    // Should have upward velocity from the applied force
    expect(state.linVel.y).toBeGreaterThan(0);
  });

  it('should apply impulse to a body', () => {
    world.addBody(makeBox('box1', 5));
    world.applyImpulse('box1', { x: 10, y: 0, z: 0 });
    world.step();

    const state = world.getBodyState('box1')!;
    expect(state.linVel.x).toBeGreaterThan(0);
  });

  it('should set body velocity', () => {
    world.addBody(makeBox('box1', 5));
    world.setBodyVelocity('box1', { x: 5, y: 0, z: 0 });

    const state = world.getBodyState('box1')!;
    expect(state.linVel.x).toBeCloseTo(5);
  });

  it('should add a sphere body', () => {
    const descriptor: BodyDescriptor = {
      id: 'sphere1',
      shape: { type: 'sphere', params: { radius: 1 } },
      motionType: 'dynamic',
      position: { x: 0, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    world.addBody(descriptor);
    expect(world.hasBody('sphere1')).toBe(true);
  });

  it('should add a static body', () => {
    const descriptor: BodyDescriptor = {
      id: 'ground',
      shape: { type: 'box', params: { halfExtents: { x: 50, y: 0.5, z: 50 } } },
      motionType: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    world.addBody(descriptor);

    // Static body shouldn't move
    world.step();
    const state = world.getBodyState('ground')!;
    expect(state.position.y).toBeCloseTo(-0.5);
  });

  it('should apply input actions', () => {
    world.addBody(makeBox('box1', 5));
    world.applyInput({
      type: 'applyForce',
      bodyId: 'box1',
      data: { force: { x: 0, y: 50, z: 0 } },
    });
    world.step();

    const state = world.getBodyState('box1')!;
    expect(state.linVel.y).toBeGreaterThan(0);
  });

  it('should load state from body descriptors', () => {
    world.loadState([
      makeBox('box1', 5),
      makeBox('box2', 10),
      makeBox('box3', 15),
    ]);
    expect(world.bodyCount).toBe(3);
  });
});
