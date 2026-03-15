import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConstraintDescriptor, ConstraintUpdates } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from '../physics-world/pw-types.js';

// --- Mocks ---

vi.mock('@rapierphysicsplugin/shared', () => ({
  createJointData: vi.fn(() => ({ __mock: true })),
}));

import { createJointData } from '@rapierphysicsplugin/shared';
import {
  addConstraint,
  removeConstraint,
  updateConstraint,
  hasConstraint,
} from '../physics-world/pw-constraints.js';

// --- Helpers ---

function makeMockJoint() {
  return {
    setContactsEnabled: vi.fn(),
    setEnabled: vi.fn(),
    setLimits: vi.fn(),
    configureMotor: vi.fn(),
    configureMotorVelocity: vi.fn(),
    configureMotorPosition: vi.fn(),
    setMotorMaxForce: vi.fn(),
  };
}

function makeCtx(overrides?: Partial<PhysicsWorldContext>): PhysicsWorldContext {
  return {
    rapier: {} as any,
    world: {
      createImpulseJoint: vi.fn(() => makeMockJoint()),
      removeImpulseJoint: vi.fn(),
    } as any,
    bodyMap: new Map(),
    colliderMap: new Map(),
    colliderHandleToBodyId: new Map(),
    constraintMap: new Map(),
    activeCollisionPairs: new Set(),
    eventQueue: {} as any,
    ...overrides,
  };
}

function makeDescriptor(overrides?: Partial<ConstraintDescriptor>): ConstraintDescriptor {
  return {
    id: 'joint1',
    type: 2, // hinge
    bodyIdA: 'bodyA',
    bodyIdB: 'bodyB',
    ...overrides,
  } as ConstraintDescriptor;
}

// --- Tests ---

describe('pw-constraints', () => {
  let ctx: PhysicsWorldContext;
  let joint: ReturnType<typeof makeMockJoint>;

  beforeEach(() => {
    vi.clearAllMocks();
    joint = makeMockJoint();
    ctx = makeCtx({
      world: {
        createImpulseJoint: vi.fn(() => joint),
        removeImpulseJoint: vi.fn(),
      } as any,
    });
    ctx.bodyMap.set('bodyA', {} as any);
    ctx.bodyMap.set('bodyB', {} as any);
  });

  // -------------------------------------------------------
  // addConstraint
  // -------------------------------------------------------
  describe('addConstraint', () => {
    it('creates joint and stores it in constraintMap', () => {
      addConstraint(ctx, makeDescriptor());

      expect(createJointData).toHaveBeenCalledWith(ctx.rapier, expect.objectContaining({ id: 'joint1' }));
      expect(ctx.world.createImpulseJoint).toHaveBeenCalledWith(
        { __mock: true },
        ctx.bodyMap.get('bodyA'),
        ctx.bodyMap.get('bodyB'),
        true,
      );
      expect(ctx.constraintMap.has('joint1')).toBe(true);
      expect(ctx.constraintMap.get('joint1')).toBe(joint);
    });

    it('returns the constraint id', () => {
      const id = addConstraint(ctx, makeDescriptor({ id: 'myJoint' }));
      expect(id).toBe('myJoint');
    });

    it('throws if constraint id already exists', () => {
      addConstraint(ctx, makeDescriptor({ id: 'dup' }));
      expect(() => addConstraint(ctx, makeDescriptor({ id: 'dup' }))).toThrow(
        'Constraint with id "dup" already exists',
      );
    });

    it('throws if bodyA not found', () => {
      ctx.bodyMap.delete('bodyA');
      expect(() => addConstraint(ctx, makeDescriptor())).toThrow(
        'Body "bodyA" not found for constraint "joint1"',
      );
    });

    it('throws if bodyB not found', () => {
      ctx.bodyMap.delete('bodyB');
      expect(() => addConstraint(ctx, makeDescriptor())).toThrow(
        'Body "bodyB" not found for constraint "joint1"',
      );
    });

    it('disables contacts when collision === false', () => {
      addConstraint(ctx, makeDescriptor({ collision: false } as any));
      expect(joint.setContactsEnabled).toHaveBeenCalledWith(false);
    });

    it('does not disable contacts when collision is not false', () => {
      addConstraint(ctx, makeDescriptor());
      expect(joint.setContactsEnabled).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // removeConstraint
  // -------------------------------------------------------
  describe('removeConstraint', () => {
    it('removes joint from world and constraintMap', () => {
      addConstraint(ctx, makeDescriptor({ id: 'r1' }));
      expect(ctx.constraintMap.has('r1')).toBe(true);

      removeConstraint(ctx, 'r1');

      expect(ctx.world.removeImpulseJoint).toHaveBeenCalledWith(joint, true);
      expect(ctx.constraintMap.has('r1')).toBe(false);
    });

    it('no-ops silently when id not found', () => {
      removeConstraint(ctx, 'nonexistent');
      expect(ctx.world.removeImpulseJoint).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // updateConstraint
  // -------------------------------------------------------
  describe('updateConstraint', () => {
    beforeEach(() => {
      // Pre-populate a constraint so updateConstraint can find it
      addConstraint(ctx, makeDescriptor({ id: 'u1' }));
      vi.clearAllMocks();
    });

    it('no-ops silently when id not found', () => {
      updateConstraint(ctx, 'missing', { enabled: false });
      expect(joint.setEnabled).not.toHaveBeenCalled();
    });

    it('sets enabled on joint', () => {
      updateConstraint(ctx, 'u1', { enabled: false });
      expect(joint.setEnabled).toHaveBeenCalledWith(false);
    });

    it('sets collisions enabled on joint', () => {
      updateConstraint(ctx, 'u1', { collisionsEnabled: true });
      expect(joint.setContactsEnabled).toHaveBeenCalledWith(true);
    });

    it('sets limits from axisUpdates', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, minLimit: -1.5, maxLimit: 1.5 }],
      });
      expect(joint.setLimits).toHaveBeenCalledWith(-1.5, 1.5);
    });

    // --- Motor type tests ---

    it('velocity motor (motorType=1): calls configureMotorVelocity with target and damping', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 1, motorTarget: 5.0, damping: 50 }],
      });
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(5.0, 50);
    });

    it('velocity motor uses default target 0 and default damping 100 when not provided', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 1 }],
      });
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 100);
    });

    it('position motor (motorType=2): calls configureMotorPosition with target, stiffness, damping', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 2, motorTarget: 1.57, stiffness: 500, damping: 25 }],
      });
      expect(joint.configureMotorPosition).toHaveBeenCalledWith(1.57, 500, 25);
    });

    it('position motor uses default target 0, stiffness 1000, damping 100 when not provided', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 2 }],
      });
      expect(joint.configureMotorPosition).toHaveBeenCalledWith(0, 1000, 100);
    });

    it('NONE motor (motorType=0) with friction > 0: calls configureMotorVelocity(0, friction)', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 0, friction: 10 }],
      });
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 10);
    });

    it('NONE motor with no friction: calls configureMotor(0,0,0,0) and setMotorMaxForce(0)', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 0 }],
      });
      expect(joint.configureMotor).toHaveBeenCalledWith(0, 0, 0, 0);
      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(0);
    });

    // --- motorTarget update ---

    it('motorTarget update without prior motorType set: no-op', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorTarget: 5.0 }],
      });
      expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
      expect(joint.configureMotorPosition).not.toHaveBeenCalled();
    });

    it('motorTarget update with existing motorType: updates and re-applies', () => {
      // First, set a velocity motor so config is stored
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 1, motorTarget: 1.0, damping: 50 }],
      });
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(1.0, 50);
      vi.clearAllMocks();

      // Now update only the target
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorTarget: 7.5 }],
      });
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(7.5, 50);
    });

    it('motorTarget update re-applies position motor when type was 2', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 2, motorTarget: 0.5, stiffness: 800, damping: 60 }],
      });
      vi.clearAllMocks();

      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorTarget: 2.0 }],
      });
      expect(joint.configureMotorPosition).toHaveBeenCalledWith(2.0, 800, 60);
    });

    // --- Friction update ---

    it('friction update with existing motor config', () => {
      // Set a velocity motor first
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 1, motorTarget: 3.0, damping: 20 }],
      });
      vi.clearAllMocks();

      // Update friction only
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, friction: 15 }],
      });
      // With motorType=1 (velocity), applyMotor calls configureMotorVelocity
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(3.0, 20);
    });

    it('friction update without motor config: no-op', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, friction: 15 }],
      });
      expect(joint.configureMotorVelocity).not.toHaveBeenCalled();
      expect(joint.configureMotorPosition).not.toHaveBeenCalled();
      expect(joint.configureMotor).not.toHaveBeenCalled();
    });

    it('friction stored in config is used by subsequent NONE motor type', () => {
      // Set a velocity motor first to create config with friction
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 1, friction: 25 }],
      });
      vi.clearAllMocks();

      // Now switch to NONE motor type; friction should come from config
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorType: 0 }],
      });
      // NONE with friction > 0 calls configureMotorVelocity(0, friction)
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(0, 25);
    });

    // --- motorMaxForce ---

    it('motorMaxForce: calls setMotorMaxForce', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, motorMaxForce: 500 }],
      });
      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(500);
    });

    // --- Combined updates ---

    it('applies multiple update fields in a single call', () => {
      updateConstraint(ctx, 'u1', {
        enabled: true,
        collisionsEnabled: false,
        axisUpdates: [
          { axis: 3, minLimit: -2, maxLimit: 2, motorType: 1, motorTarget: 4.0, damping: 30, motorMaxForce: 200 },
        ],
      });
      expect(joint.setEnabled).toHaveBeenCalledWith(true);
      expect(joint.setContactsEnabled).toHaveBeenCalledWith(false);
      expect(joint.setLimits).toHaveBeenCalledWith(-2, 2);
      expect(joint.configureMotorVelocity).toHaveBeenCalledWith(4.0, 30);
      expect(joint.setMotorMaxForce).toHaveBeenCalledWith(200);
    });

    it('does not set limits when only one of minLimit or maxLimit is provided', () => {
      updateConstraint(ctx, 'u1', {
        axisUpdates: [{ axis: 3, minLimit: -1 }],
      });
      expect(joint.setLimits).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------
  // hasConstraint
  // -------------------------------------------------------
  describe('hasConstraint', () => {
    it('returns true when constraint exists', () => {
      addConstraint(ctx, makeDescriptor({ id: 'exists' }));
      expect(hasConstraint(ctx, 'exists')).toBe(true);
    });

    it('returns false when constraint does not exist', () => {
      expect(hasConstraint(ctx, 'nope')).toBe(false);
    });
  });
});
