import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics-world/index.js';
import { SERVER_TICK_RATE } from '@rapierphysicsplugin/shared';
import { mphToMs, kmhToMs, rpmToRadS } from '@rapierphysicsplugin/shared';
import type { BodyDescriptor } from '@rapierphysicsplugin/shared';

/**
 * Physics simulation unit validation tests.
 *
 * These tests verify that Rapier's simulation produces correct real-world
 * results when 1 world unit = 1 meter. All bodies start high (y=100) so
 * gravity doesn't cause ground collisions during the test window.
 */

describe('Physics unit validation (1 unit = 1 m)', () => {
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

  const STEPS_PER_SECOND = SERVER_TICK_RATE; // 60

  function stepSeconds(seconds: number) {
    const steps = Math.round(seconds * STEPS_PER_SECOND);
    for (let i = 0; i < steps; i++) world.step();
  }

  function makeSphere(id: string, y = 100): BodyDescriptor {
    return {
      id,
      shape: { type: 'sphere', params: { radius: 0.5 } },
      motionType: 'dynamic',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      mass: 1.0,
    };
  }

  function makeBox(id: string, y = 100): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
      motionType: 'dynamic',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      mass: 1.0,
    };
  }

  // --- Linear velocity ---

  describe('linear velocity (m/s)', () => {
    it('1 m/s for 1 second ≈ 1 m displacement', () => {
      world.addBody(makeSphere('ball'));
      world.setBodyVelocity('ball', { x: 1, y: 0, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(1.0, 1);
    });

    it('5 m/s for 2 seconds ≈ 10 m displacement', () => {
      world.addBody(makeSphere('ball'));
      world.setBodyVelocity('ball', { x: 5, y: 0, z: 0 });
      stepSeconds(2);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(10.0, 1);
    });

    it('velocity in multiple axes produces correct diagonal displacement', () => {
      world.addBody(makeSphere('ball'));
      world.setBodyVelocity('ball', { x: 3, y: 0, z: 4 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(3.0, 1);
      expect(state.position.z).toBeCloseTo(4.0, 1);
      // Total displacement = 5m (3-4-5 triangle)
      const dist = Math.sqrt(state.position.x ** 2 + state.position.z ** 2);
      expect(dist).toBeCloseTo(5.0, 1);
    });
  });

  // --- Unit conversions ---

  describe('unit conversions', () => {
    it('60 mph ≈ 26.82 m/s → travels ~26.82 m in 1 second', () => {
      world.addBody(makeSphere('ball'));
      world.setBodyVelocity('ball', { x: mphToMs(60), y: 0, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(26.82, 0);
    });

    it('100 km/h ≈ 27.78 m/s → travels ~27.78 m in 1 second', () => {
      world.addBody(makeSphere('ball'));
      world.setBodyVelocity('ball', { x: kmhToMs(100), y: 0, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(27.78, 0);
    });

    it('60 RPM → 1 full revolution per second (2π rad)', () => {
      world.addBody(makeBox('spinner'));
      world.setBodyVelocity('spinner', { x: 0, y: 0, z: 0 }, { x: 0, y: rpmToRadS(60), z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('spinner')!;
      // Angular velocity should remain ~2π rad/s (no angular friction by default)
      expect(state.angVel.y).toBeCloseTo(2 * Math.PI, 1);
    });
  });

  // --- Gravity / free fall ---

  describe('gravity (free fall)', () => {
    it('free fall for 1 second ≈ 4.905 m (½gt²)', () => {
      world.addBody(makeSphere('ball'));
      const y0 = world.getBodyState('ball')!.position.y;
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      const fallen = y0 - state.position.y;
      // ½ * 9.81 * 1² = 4.905
      expect(fallen).toBeCloseTo(4.905, 0);
    });

    it('free fall velocity after 1 second ≈ 9.81 m/s', () => {
      world.addBody(makeSphere('ball'));
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.linVel.y).toBeCloseTo(-9.81, 0);
    });

    it('free fall for 2 seconds ≈ 19.62 m (½gt²)', () => {
      world.addBody(makeSphere('ball'));
      const y0 = world.getBodyState('ball')!.position.y;
      stepSeconds(2);

      const state = world.getBodyState('ball')!;
      const fallen = y0 - state.position.y;
      // ½ * 9.81 * 4 = 19.62
      expect(fallen).toBeCloseTo(19.62, 0);
    });
  });

  // --- Impulse ---

  describe('impulse (N·s)', () => {
    it('impulse of 1 N·s on 1 kg body → 1 m/s instant velocity', () => {
      world.addBody(makeSphere('ball'));
      world.applyImpulse('ball', { x: 1, y: 0, z: 0 });
      world.step();

      const state = world.getBodyState('ball')!;
      // v = impulse / mass = 1 / 1 = 1 m/s
      expect(state.linVel.x).toBeCloseTo(1.0, 1);
    });

    it('impulse of 10 N·s on 1 kg body → 10 m/s, travels ~10 m in 1 s', () => {
      world.addBody(makeSphere('ball'));
      world.applyImpulse('ball', { x: 10, y: 0, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(10.0, 0);
    });

    it('impulse of 5 N·s on 5 kg body → 1 m/s', () => {
      const desc = makeSphere('heavy');
      desc.mass = 5;
      world.addBody(desc);
      world.applyImpulse('heavy', { x: 5, y: 0, z: 0 });
      world.step();

      const state = world.getBodyState('heavy')!;
      expect(state.linVel.x).toBeCloseTo(1.0, 1);
    });
  });

  // --- Force ---

  describe('force (N)', () => {
    // Note: Rapier's addForce() accumulates — forces persist until resetForces().
    // Each test applies force once, steps once, and checks the single-step result.

    it('1 N on 1 kg body for one step → Δv = F·dt/m', () => {
      world.addBody(makeSphere('ball'));
      world.applyForce('ball', { x: 1, y: 0, z: 0 });
      world.step();

      const state = world.getBodyState('ball')!;
      const dt = 1 / STEPS_PER_SECOND;
      // Δv = F * dt / m = 1 * (1/60) / 1 ≈ 0.0167 m/s
      expect(state.linVel.x).toBeCloseTo(dt, 3);
    });

    it('600 N on 1 kg body for one step → Δv = 10 m/s', () => {
      world.addBody(makeSphere('ball'));
      // F * dt / m = 600 * (1/60) / 1 = 10 m/s
      world.applyForce('ball', { x: 600, y: 0, z: 0 });
      world.step();

      const state = world.getBodyState('ball')!;
      expect(state.linVel.x).toBeCloseTo(10.0, 1);
    });

    it('sustained force via impulse-per-step: 1 m/s² for 1 s → 1 m/s', () => {
      world.addBody(makeSphere('ball'));
      const dt = 1 / STEPS_PER_SECOND;

      // Simulate constant 1 N force using per-step impulses (F·dt = 1/60 N·s)
      for (let i = 0; i < STEPS_PER_SECOND; i++) {
        world.applyImpulse('ball', { x: 1 * dt, y: 0, z: 0 });
        world.step();
      }

      const state = world.getBodyState('ball')!;
      expect(state.linVel.x).toBeCloseTo(1.0, 1);
      // x = ½at² = 0.5 m
      expect(state.position.x).toBeCloseTo(0.5, 0);
    });

    it('counteract gravity with per-step impulse → body hovers', () => {
      world.addBody(makeSphere('ball'));
      const y0 = world.getBodyState('ball')!.position.y;
      const dt = 1 / STEPS_PER_SECOND;

      // Apply g·m·dt upward impulse each step to cancel gravity
      for (let i = 0; i < STEPS_PER_SECOND; i++) {
        world.applyImpulse('ball', { x: 0, y: 9.81 * dt, z: 0 });
        world.step();
      }

      const state = world.getBodyState('ball')!;
      expect(state.position.y).toBeCloseTo(y0, 0);
      expect(state.linVel.y).toBeCloseTo(0, 0);
    });
  });

  // --- Projectile motion ---

  describe('projectile motion', () => {
    it('horizontal launch at 10 m/s: after 1s, x≈10 m, fallen ≈4.9 m', () => {
      world.addBody(makeSphere('ball'));
      const y0 = world.getBodyState('ball')!.position.y;
      world.setBodyVelocity('ball', { x: 10, y: 0, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      expect(state.position.x).toBeCloseTo(10.0, 0);
      expect(y0 - state.position.y).toBeCloseTo(4.905, 0);
    });

    it('launched upward at 9.81 m/s: peak at ~1s, height ≈ 4.9 m', () => {
      world.addBody(makeSphere('ball'));
      const y0 = world.getBodyState('ball')!.position.y;
      world.setBodyVelocity('ball', { x: 0, y: 9.81, z: 0 });
      stepSeconds(1);

      const state = world.getBodyState('ball')!;
      // At peak: vy=0, height = v²/2g = 9.81²/(2*9.81) = 4.905
      expect(state.linVel.y).toBeCloseTo(0, 0);
      expect(state.position.y - y0).toBeCloseTo(4.905, 0);
    });
  });
});
