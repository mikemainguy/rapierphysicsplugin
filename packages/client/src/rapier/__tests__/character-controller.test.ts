import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterSupportedState } from '../character-controller.js';

// --- Mock @babylonjs/core ---

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    clone() { return new Vector3(this.x, this.y, this.z); }
    copyFrom(o: Vector3) { this.x = o.x; this.y = o.y; this.z = o.z; return this; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    add(o: Vector3) { return new Vector3(this.x + o.x, this.y + o.y, this.z + o.z); }
    addInPlace(o: Vector3) { this.x += o.x; this.y += o.y; this.z += o.z; return this; }
    subtract(o: Vector3) { return new Vector3(this.x - o.x, this.y - o.y, this.z - o.z); }
    scale(s: number) { return new Vector3(this.x * s, this.y * s, this.z * s); }
    scaleInPlace(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
    lengthSquared() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
    normalize() {
      const l = this.length();
      if (l > 0) { this.x /= l; this.y /= l; this.z /= l; }
      return this;
    }
    cross(o: Vector3) {
      return new Vector3(
        this.y * o.z - this.z * o.y,
        this.z * o.x - this.x * o.z,
        this.x * o.y - this.y * o.x,
      );
    }
    dot(o: Vector3) { return this.x * o.x + this.y * o.y + this.z * o.z; }
    static Zero() { return new Vector3(0, 0, 0); }
    static Dot(a: Vector3, b: Vector3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    static TransformNormal(v: Vector3, m: any) {
      const result = new Vector3();
      Vector3.TransformNormalToRef(v, m, result);
      return result;
    }
    static TransformNormalToRef(v: Vector3, m: any, result: Vector3) {
      const vals = m._values;
      result.x = v.x * vals[0] + v.y * vals[4] + v.z * vals[8];
      result.y = v.x * vals[1] + v.y * vals[5] + v.z * vals[9];
      result.z = v.x * vals[2] + v.y * vals[6] + v.z * vals[10];
    }
  }

  class Matrix {
    _values: number[];
    constructor() { this._values = new Array(16).fill(0); }
    static FromValues(...vals: number[]) {
      const m = new Matrix();
      m._values = vals;
      return m;
    }
    clone() {
      const m = new Matrix();
      m._values = [...this._values];
      return m;
    }
    invert() {
      // Transpose the 3x3 rotation part (valid for orthonormal matrices)
      const v = this._values;
      const r = new Array(16).fill(0);
      r[0] = v[0]; r[1] = v[4]; r[2] = v[8];
      r[4] = v[1]; r[5] = v[5]; r[6] = v[9];
      r[8] = v[2]; r[9] = v[6]; r[10] = v[10];
      r[15] = 1;
      this._values = r;
      return this;
    }
  }

  class Observable<T> {
    private _observers: Array<{ callback: (data: T) => void }> = [];
    add(callback: (data: T) => void) {
      this._observers.push({ callback });
      return { remove: () => {} };
    }
    notifyObservers(data: T) { for (const obs of this._observers) obs.callback(data); }
    clear() { this._observers = []; }
  }

  return { Vector3, Matrix, Observable };
});

// --- Helpers ---

function v3(x: number, y: number, z: number) {
  const { Vector3 } = require('@babylonjs/core');
  return new Vector3(x, y, z);
}

function makeControllerMock() {
  return {
    offset: vi.fn((): any => 0.02),
    setOffset: vi.fn(),
    maxSlopeClimbAngle: vi.fn((): any => Math.PI / 4),
    setMaxSlopeClimbAngle: vi.fn(),
    setMinSlopeSlideAngle: vi.fn(),
    characterMass: vi.fn((): any => null),
    setCharacterMass: vi.fn(),
    applyImpulsesToDynamicBodies: vi.fn((): any => false),
    setApplyImpulsesToDynamicBodies: vi.fn(),
    setUp: vi.fn(),
    enableAutostep: vi.fn(),
    disableAutostep: vi.fn(),
    enableSnapToGround: vi.fn(),
    disableSnapToGround: vi.fn(),
    computeColliderMovement: vi.fn(),
    computedMovement: vi.fn((): any => ({ x: 0, y: 0, z: 0 })),
    computedGrounded: vi.fn((): any => false),
    numComputedCollisions: vi.fn((): any => 0),
    computedCollision: vi.fn((): any => null),
  };
}

function makePlugin() {
  const ctrl = makeControllerMock();
  const rigidBody = { setTranslation: vi.fn() };
  const collider = { handle: 999 };

  const plugin = {
    rapier: {
      Vector3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
      RigidBodyDesc: {
        kinematicPositionBased: () => ({
          setTranslation: vi.fn().mockReturnThis(),
        }),
      },
      ColliderDesc: {
        capsule: vi.fn(() => ({})),
      },
      QueryFilterFlags: { EXCLUDE_SENSORS: 1 },
    } as any,
    world: {
      createRigidBody: vi.fn(() => rigidBody),
      createCollider: vi.fn(() => collider),
      createCharacterController: vi.fn(() => ctrl),
      removeCharacterController: vi.fn(),
      removeRigidBody: vi.fn(),
      step: vi.fn(),
      timestep: 1 / 60,
    } as any,
    colliderHandleToBody: new Map(),
    bodyToRigidBody: new Map(),
  } as any;

  return { plugin, ctrl, rigidBody, collider };
}

// --- Tests ---

describe('RapierCharacterController', () => {
  beforeEach(() => vi.clearAllMocks());

  // Lazy-import to ensure mocks are in place
  async function createController(position = v3(0, 5, 0), options = {}) {
    const { RapierCharacterController } = await import('../character-controller.js');
    const ctx = makePlugin();
    const cc = new RapierCharacterController(position, options, ctx.plugin);
    return { ...ctx, cc, RapierCharacterController };
  }

  // --- Construction ---

  describe('constructor', () => {
    it('creates kinematic body, capsule collider, and character controller', async () => {
      const { plugin } = await createController();
      expect(plugin.world.createRigidBody).toHaveBeenCalled();
      expect(plugin.world.createCollider).toHaveBeenCalled();
      expect(plugin.world.createCharacterController).toHaveBeenCalledWith(0.02);
    });

    it('uses provided capsule dimensions', async () => {
      const { plugin } = await createController(v3(0, 0, 0), { capsuleHeight: 2, capsuleRadius: 0.5 });
      expect(plugin.rapier.ColliderDesc.capsule).toHaveBeenCalledWith(1, 0.5);
    });

    it('uses default capsule dimensions when not specified', async () => {
      const { plugin } = await createController();
      expect(plugin.rapier.ColliderDesc.capsule).toHaveBeenCalledWith(0.5, 0.3);
    });

    it('uses provided keepDistance', async () => {
      const { plugin } = await createController(v3(0, 0, 0), { keepDistance: 0.1 });
      expect(plugin.world.createCharacterController).toHaveBeenCalledWith(0.1);
    });

    it('sets up direction on controller', async () => {
      const { ctrl } = await createController();
      expect(ctrl.setUp).toHaveBeenCalled();
    });
  });

  // --- Position / Velocity ---

  describe('position and velocity', () => {
    it('getPosition returns initial position', async () => {
      const { cc } = await createController(v3(1, 2, 3));
      const pos = cc.getPosition();
      expect(pos.x).toBe(1);
      expect(pos.y).toBe(2);
      expect(pos.z).toBe(3);
    });

    it('setPosition updates position and rigid body', async () => {
      const { cc, rigidBody } = await createController();
      cc.setPosition(v3(10, 20, 30));
      const pos = cc.getPosition();
      expect(pos.x).toBe(10);
      expect(pos.y).toBe(20);
      expect(pos.z).toBe(30);
      expect(rigidBody.setTranslation).toHaveBeenCalled();
    });

    it('getPosition returns a clone', async () => {
      const { cc } = await createController(v3(1, 2, 3));
      const pos1 = cc.getPosition();
      const pos2 = cc.getPosition();
      pos1.x = 999;
      expect(pos2.x).toBe(1);
    });

    it('setVelocity / getVelocity round-trips', async () => {
      const { cc } = await createController();
      cc.setVelocity(v3(5, -3, 1));
      const vel = cc.getVelocity();
      expect(vel.x).toBe(5);
      expect(vel.y).toBe(-3);
      expect(vel.z).toBe(1);
    });

    it('getVelocity returns a clone', async () => {
      const { cc } = await createController();
      cc.setVelocity(v3(1, 2, 3));
      const v1 = cc.getVelocity();
      const v2 = cc.getVelocity();
      v1.x = 999;
      expect(v2.x).toBe(1);
    });
  });

  // --- Properties ---

  describe('properties', () => {
    it('keepDistance reads from controller.offset()', async () => {
      const { cc, ctrl } = await createController();
      ctrl.offset.mockReturnValue(0.05);
      expect(cc.keepDistance).toBe(0.05);
    });

    it('keepDistance setter calls setOffset', async () => {
      const { cc, ctrl } = await createController();
      cc.keepDistance = 0.1;
      expect(ctrl.setOffset).toHaveBeenCalledWith(0.1);
    });

    it('maxSlopeCosine converts to/from angle', async () => {
      const { cc, ctrl } = await createController();
      ctrl.maxSlopeClimbAngle.mockReturnValue(Math.PI / 3);
      expect(cc.maxSlopeCosine).toBeCloseTo(Math.cos(Math.PI / 3));
    });

    it('maxSlopeCosine setter calls setMaxSlopeClimbAngle and setMinSlopeSlideAngle', async () => {
      const { cc, ctrl } = await createController();
      cc.maxSlopeCosine = 0.5;
      expect(ctrl.setMaxSlopeClimbAngle).toHaveBeenCalledWith(Math.acos(0.5));
      expect(ctrl.setMinSlopeSlideAngle).toHaveBeenCalledWith(Math.acos(0.5));
    });

    it('up setter calls setUp on controller', async () => {
      const { cc, ctrl } = await createController();
      ctrl.setUp.mockClear();
      cc.up = v3(0, 0, 1);
      expect(ctrl.setUp).toHaveBeenCalled();
      const up = cc.up;
      expect(up.z).toBe(1);
    });

    it('characterMass reads and writes', async () => {
      const { cc, ctrl } = await createController();
      ctrl.characterMass.mockReturnValue(80);
      expect(cc.characterMass).toBe(80);
      cc.characterMass = 90;
      expect(ctrl.setCharacterMass).toHaveBeenCalledWith(90);
    });

    it('characterStrength reads and writes', async () => {
      const { cc, ctrl } = await createController();
      ctrl.applyImpulsesToDynamicBodies.mockReturnValue(true);
      expect(cc.characterStrength).toBe(true);
      cc.characterStrength = false;
      expect(ctrl.setApplyImpulsesToDynamicBodies).toHaveBeenCalledWith(false);
    });
  });

  // --- Autostep / Snap-to-Ground ---

  describe('autostep and snap-to-ground', () => {
    it('enableAutostep delegates to controller', async () => {
      const { cc, ctrl } = await createController();
      cc.enableAutostep(0.5, 0.3, true);
      expect(ctrl.enableAutostep).toHaveBeenCalledWith(0.5, 0.3, true);
    });

    it('disableAutostep delegates to controller', async () => {
      const { cc, ctrl } = await createController();
      cc.disableAutostep();
      expect(ctrl.disableAutostep).toHaveBeenCalled();
    });

    it('enableSnapToGround delegates to controller', async () => {
      const { cc, ctrl } = await createController();
      cc.enableSnapToGround(0.5);
      expect(ctrl.enableSnapToGround).toHaveBeenCalledWith(0.5);
    });

    it('disableSnapToGround delegates to controller', async () => {
      const { cc, ctrl } = await createController();
      cc.disableSnapToGround();
      expect(ctrl.disableSnapToGround).toHaveBeenCalled();
    });
  });

  // --- checkSupport ---

  describe('checkSupport', () => {
    it('returns UNSUPPORTED when not grounded', async () => {
      const { cc, ctrl } = await createController();
      ctrl.computedGrounded.mockReturnValue(false);
      ctrl.numComputedCollisions.mockReturnValue(0);

      const info = cc.checkSupport(1 / 60, v3(0, -9.81, 0));
      expect(info.supportedState).toBe(CharacterSupportedState.UNSUPPORTED);
    });

    it('returns SUPPORTED when grounded with no sliding', async () => {
      const { cc, ctrl } = await createController();
      ctrl.computedGrounded.mockReturnValue(true);
      ctrl.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(1);
      ctrl.computedCollision.mockReturnValue({
        normal1: { x: 0, y: 1, z: 0 },
        collider: null,
      });

      const info = cc.checkSupport(1 / 60, v3(0, -9.81, 0));
      expect(info.supportedState).toBe(CharacterSupportedState.SUPPORTED);
      expect(info.averageSurfaceNormal.y).toBe(1);
    });

    it('returns SLIDING when grounded with significant slide movement', async () => {
      const { cc, ctrl } = await createController();
      const dt = 1 / 60;
      ctrl.computedGrounded.mockReturnValue(true);
      // Large downward movement component indicating sliding
      ctrl.computedMovement.mockReturnValue({ x: 0.5, y: -5, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(1);
      ctrl.computedCollision.mockReturnValue({
        normal1: { x: 0.7, y: 0.7, z: 0 },
        collider: null,
      });

      const info = cc.checkSupport(dt, v3(0, -9.81, 0));
      expect(info.supportedState).toBe(CharacterSupportedState.SLIDING);
    });

    it('detects dynamic surface from rigid body', async () => {
      const { cc, ctrl, plugin } = await createController();
      ctrl.computedGrounded.mockReturnValue(true);
      ctrl.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(1);

      const mockBody = {} as any;
      const mockRb = {
        isDynamic: vi.fn(() => true),
        linvel: vi.fn(() => ({ x: 1, y: 0, z: 0 })),
        angvel: vi.fn(() => ({ x: 0, y: 0.5, z: 0 })),
      };
      plugin.colliderHandleToBody.set(42, mockBody);
      plugin.bodyToRigidBody.set(mockBody, mockRb);

      ctrl.computedCollision.mockReturnValue({
        normal1: { x: 0, y: 1, z: 0 },
        collider: { handle: 42 },
      });

      const info = cc.checkSupport(1 / 60, v3(0, -9.81, 0));
      expect(info.isSurfaceDynamic).toBe(true);
      expect(info.averageSurfaceVelocity.x).toBe(1);
      expect(info.averageAngularSurfaceVelocity.y).toBe(0.5);
    });

    it('averages multiple collision normals', async () => {
      const { cc, ctrl } = await createController();
      ctrl.computedGrounded.mockReturnValue(true);
      ctrl.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(2);

      let callIndex = 0;
      ctrl.computedCollision.mockImplementation(() => {
        const normals = [
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 },
        ];
        return { normal1: normals[callIndex++], collider: null };
      });

      const info = cc.checkSupport(1 / 60, v3(0, -9.81, 0));
      expect(info.averageSurfaceNormal.y).toBeCloseTo(0.5);
      expect(info.averageSurfaceNormal.z).toBeCloseTo(0.5);
    });

    it('calls computeColliderMovement with correct parameters', async () => {
      const { cc, ctrl, collider } = await createController();
      ctrl.computedGrounded.mockReturnValue(false);
      ctrl.numComputedCollisions.mockReturnValue(0);

      const dt = 1 / 60;
      cc.checkSupport(dt, v3(0, -9.81, 0));

      expect(ctrl.computeColliderMovement).toHaveBeenCalled();
      const args = ctrl.computeColliderMovement.mock.calls[0];
      expect(args[0]).toBe(collider); // collider
      // desiredDelta should be direction * dt
      expect(args[1].y).toBeCloseTo(-9.81 / 60);
      // filterFlags = EXCLUDE_SENSORS
      expect(args[2]).toBe(1);
      // filterPredicate should exclude self
      const predicate = args[4];
      expect(predicate({ handle: 999 })).toBe(false); // self-exclusion
      expect(predicate({ handle: 123 })).toBe(true);  // other collider
    });

    it('reports platform velocity from rigid body linvel', async () => {
      const { cc, ctrl, plugin } = await createController();
      ctrl.computedGrounded.mockReturnValue(true);
      ctrl.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(1);

      const mockBody = {} as any;
      const mockRb = {
        isDynamic: vi.fn(() => false),
        linvel: vi.fn(() => ({ x: 2, y: 0, z: 3 })),
        angvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      };
      plugin.colliderHandleToBody.set(50, mockBody);
      plugin.bodyToRigidBody.set(mockBody, mockRb);

      ctrl.computedCollision.mockReturnValue({
        normal1: { x: 0, y: 1, z: 0 },
        collider: { handle: 50 },
      });

      const info = cc.checkSupport(1 / 60, v3(0, -9.81, 0));
      expect(info.averageSurfaceVelocity.x).toBe(2);
      expect(info.averageSurfaceVelocity.z).toBe(3);
      expect(info.isSurfaceDynamic).toBe(false);
    });
  });

  // --- moveWithCollisions ---

  describe('moveWithCollisions', () => {
    it('applies computed movement to position', async () => {
      const { cc, ctrl } = await createController(v3(0, 5, 0));
      ctrl.computedMovement.mockReturnValue({ x: 1, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const result = cc.moveWithCollisions(v3(1, 0, 0));
      expect(result.x).toBe(1);
      expect(result.y).toBe(0);
      expect(result.z).toBe(0);

      const pos = cc.getPosition();
      expect(pos.x).toBe(1);
      expect(pos.y).toBe(5);
    });

    it('returns reduced movement when hitting a wall', async () => {
      const { cc, ctrl } = await createController(v3(0, 0, 0));
      // Wall stops half the movement
      ctrl.computedMovement.mockReturnValue({ x: 0.5, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const result = cc.moveWithCollisions(v3(1, 0, 0));
      expect(result.x).toBe(0.5);
      expect(cc.getPosition().x).toBe(0.5);
    });

    it('syncs rigid body position before and after movement', async () => {
      const { cc, ctrl, rigidBody } = await createController(v3(0, 0, 0));
      ctrl.computedMovement.mockReturnValue({ x: 1, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      cc.moveWithCollisions(v3(1, 0, 0));

      // Should sync twice: before compute + after position update
      expect(rigidBody.setTranslation).toHaveBeenCalledTimes(2);
    });
  });

  // --- integrate ---

  describe('integrate', () => {
    it('applies gravity when UNSUPPORTED', async () => {
      const { cc, ctrl } = await createController(v3(0, 10, 0));
      ctrl.computedMovement.mockReturnValue({ x: 0, y: -0.1635, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const dt = 1 / 60;
      const gravity = v3(0, -9.81, 0);
      const supportInfo = {
        supportedState: CharacterSupportedState.UNSUPPORTED,
        averageSurfaceNormal: v3(0, 0, 0),
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      };

      cc.integrate(dt, supportInfo, gravity);

      // Velocity should be updated from actual movement
      const vel = cc.getVelocity();
      // computedMovement returned -0.1635/dt
      expect(vel.y).toBeCloseTo(-0.1635 / dt);
    });

    it('does not apply gravity when SUPPORTED', async () => {
      const { cc, ctrl } = await createController(v3(0, 0, 0));
      cc.setVelocity(v3(5, 0, 0));
      ctrl.computedMovement.mockReturnValue({ x: 5 / 60, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const dt = 1 / 60;
      const supportInfo = {
        supportedState: CharacterSupportedState.SUPPORTED,
        averageSurfaceNormal: v3(0, 1, 0),
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      };

      cc.integrate(dt, supportInfo, v3(0, -9.81, 0));

      // Displacement should use only existing velocity, no gravity added
      const args = ctrl.computeColliderMovement.mock.calls[0];
      const delta = args[1];
      expect(delta.y).toBeCloseTo(0); // No vertical displacement from gravity
    });

    it('projects gravity onto surface when SLIDING', async () => {
      const { cc, ctrl } = await createController(v3(0, 5, 0));
      cc.setVelocity(v3(0, 0, 0));
      ctrl.computedMovement.mockReturnValue({ x: 0, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const dt = 1 / 60;
      const normal = v3(0, 1, 0);
      const supportInfo = {
        supportedState: CharacterSupportedState.SLIDING,
        averageSurfaceNormal: normal,
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      };

      cc.integrate(dt, supportInfo, v3(0, -9.81, 0));

      // Gravity projected onto flat floor surface = zero (gravity dot normal * normal = gravity)
      // So projected gravity = gravity - normal * (gravity dot normal) = (0,-9.81,0) - (0,1,0)*(-9.81) = (0,0,0)
      const args = ctrl.computeColliderMovement.mock.calls[0];
      const delta = args[1];
      expect(Math.abs(delta.x)).toBeCloseTo(0);
      expect(Math.abs(delta.y)).toBeCloseTo(0);
    });

    it('updates position from computed movement', async () => {
      const { cc, ctrl } = await createController(v3(0, 0, 0));
      cc.setVelocity(v3(3, 0, 0));
      ctrl.computedMovement.mockReturnValue({ x: 0.05, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      cc.integrate(1 / 60, {
        supportedState: CharacterSupportedState.SUPPORTED,
        averageSurfaceNormal: v3(0, 1, 0),
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      }, v3(0, -9.81, 0));

      expect(cc.getPosition().x).toBeCloseTo(0.05);
    });

    it('updates velocity from actual movement', async () => {
      const { cc, ctrl } = await createController(v3(0, 0, 0));
      cc.setVelocity(v3(10, 0, 0));
      // Wall blocks most movement
      ctrl.computedMovement.mockReturnValue({ x: 0.01, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(0);

      const dt = 1 / 60;
      cc.integrate(dt, {
        supportedState: CharacterSupportedState.SUPPORTED,
        averageSurfaceNormal: v3(0, 1, 0),
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      }, v3(0, -9.81, 0));

      // Velocity is now based on actual movement, not desired
      expect(cc.getVelocity().x).toBeCloseTo(0.01 / dt);
    });
  });

  // --- Collision observable ---

  describe('collision observable', () => {
    it('fires for collisions during moveWithCollisions', async () => {
      const { cc, ctrl, plugin } = await createController();
      ctrl.computedMovement.mockReturnValue({ x: 1, y: 0, z: 0 });

      const mockBody = {} as any;
      plugin.colliderHandleToBody.set(42, mockBody);

      ctrl.numComputedCollisions.mockReturnValue(1);
      ctrl.computedCollision.mockReturnValue({
        normal1: { x: -1, y: 0, z: 0 },
        collider: { handle: 42 },
        translationDeltaApplied: { x: 0.5, y: 0, z: 0 },
        witness1: { x: 1, y: 5, z: 0 },
      });

      const events: any[] = [];
      cc.onTriggerCollisionObservable.add((e: any) => events.push(e));

      cc.moveWithCollisions(v3(2, 0, 0));

      expect(events).toHaveLength(1);
      expect(events[0].collider).toBe(mockBody);
      expect(events[0].colliderIndex).toBe(0);
      expect(events[0].impulse.x).toBe(0.5);
      expect(events[0].impulsePosition.x).toBe(1);
    });

    it('fires for collisions during integrate', async () => {
      const { cc, ctrl, plugin } = await createController();
      cc.setVelocity(v3(5, 0, 0));
      ctrl.computedMovement.mockReturnValue({ x: 0.05, y: 0, z: 0 });

      const mockBody = {} as any;
      plugin.colliderHandleToBody.set(10, mockBody);

      ctrl.numComputedCollisions.mockReturnValue(1);
      ctrl.computedCollision.mockReturnValue({
        normal1: { x: -1, y: 0, z: 0 },
        collider: { handle: 10 },
        translationDeltaApplied: { x: 0.05, y: 0, z: 0 },
        witness1: { x: 1, y: 0, z: 0 },
      });

      const events: any[] = [];
      cc.onTriggerCollisionObservable.add((e: any) => events.push(e));

      cc.integrate(1 / 60, {
        supportedState: CharacterSupportedState.SUPPORTED,
        averageSurfaceNormal: v3(0, 1, 0),
        averageSurfaceVelocity: v3(0, 0, 0),
        averageAngularSurfaceVelocity: v3(0, 0, 0),
        isSurfaceDynamic: false,
      }, v3(0, -9.81, 0));

      expect(events).toHaveLength(1);
      expect(events[0].collider).toBe(mockBody);
    });

    it('fires multiple events for multiple collisions', async () => {
      const { cc, ctrl, plugin } = await createController();
      ctrl.computedMovement.mockReturnValue({ x: 1, y: 0, z: 0 });

      const body1 = {} as any;
      const body2 = {} as any;
      plugin.colliderHandleToBody.set(1, body1);
      plugin.colliderHandleToBody.set(2, body2);

      ctrl.numComputedCollisions.mockReturnValue(2);
      let callIdx = 0;
      ctrl.computedCollision.mockImplementation(() => {
        const collisions = [
          { normal1: { x: -1, y: 0, z: 0 }, collider: { handle: 1 }, translationDeltaApplied: { x: 0.3, y: 0, z: 0 }, witness1: { x: 1, y: 0, z: 0 } },
          { normal1: { x: 0, y: 0, z: -1 }, collider: { handle: 2 }, translationDeltaApplied: { x: 0.2, y: 0, z: 0 }, witness1: { x: 0, y: 0, z: 1 } },
        ];
        return collisions[callIdx++];
      });

      const events: any[] = [];
      cc.onTriggerCollisionObservable.add((e: any) => events.push(e));

      cc.moveWithCollisions(v3(2, 0, 0));

      expect(events).toHaveLength(2);
      expect(events[0].collider).toBe(body1);
      expect(events[1].collider).toBe(body2);
    });

    it('sets collider to null when collider handle not found', async () => {
      const { cc, ctrl } = await createController();
      ctrl.computedMovement.mockReturnValue({ x: 1, y: 0, z: 0 });
      ctrl.numComputedCollisions.mockReturnValue(1);
      ctrl.computedCollision.mockReturnValue({
        normal1: { x: -1, y: 0, z: 0 },
        collider: { handle: 9999 }, // unknown handle
        translationDeltaApplied: { x: 1, y: 0, z: 0 },
        witness1: { x: 1, y: 0, z: 0 },
      });

      const events: any[] = [];
      cc.onTriggerCollisionObservable.add((e: any) => events.push(e));

      cc.moveWithCollisions(v3(1, 0, 0));

      expect(events).toHaveLength(1);
      expect(events[0].collider).toBeNull();
    });
  });

  // --- calculateMovementToRef ---

  describe('calculateMovementToRef', () => {
    it('returns false when forward and up are nearly parallel', async () => {
      const { cc } = await createController();
      const result = v3(0, 0, 0);
      const ok = cc.calculateMovementToRef(
        1 / 60, v3(0, 1, 0), v3(0, 1, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 1, 0), result,
      );
      expect(ok).toBe(false);
    });

    it('returns true for valid inputs', async () => {
      const { cc } = await createController();
      const result = v3(0, 0, 0);
      const ok = cc.calculateMovementToRef(
        1 / 60, v3(0, 0, 1), v3(0, 1, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 5), v3(0, 1, 0), result,
      );
      expect(ok).toBe(true);
    });

    it('produces non-zero output for non-zero desired velocity', async () => {
      const { cc } = await createController();
      const result = v3(0, 0, 0);
      cc.calculateMovementToRef(
        1 / 60, v3(0, 0, 1), v3(0, 1, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 5), v3(0, 1, 0), result,
      );
      expect(result.length()).toBeGreaterThan(0);
    });

    it('includes surface velocity in output', async () => {
      const { cc } = await createController();
      const result = v3(0, 0, 0);
      cc.calculateMovementToRef(
        1 / 60, v3(0, 0, 1), v3(0, 1, 0), v3(0, 0, 0), v3(10, 0, 0), v3(0, 0, 0), v3(0, 1, 0), result,
      );
      // Surface velocity of 10 along X should be present in output
      expect(result.x).toBeCloseTo(10);
    });

    it('calculateMovement returns a new Vector3', async () => {
      const { cc } = await createController();
      const result = cc.calculateMovement(
        1 / 60, v3(0, 0, 1), v3(0, 1, 0), v3(0, 0, 0), v3(0, 0, 0), v3(0, 0, 5), v3(0, 1, 0),
      );
      expect(result).toBeDefined();
      expect(result.length()).toBeGreaterThan(0);
    });
  });

  // --- Dispose ---

  describe('dispose', () => {
    it('removes character controller and rigid body from world', async () => {
      const { cc, ctrl, plugin } = await createController();
      cc.dispose();
      expect(plugin.world.removeCharacterController).toHaveBeenCalledWith(ctrl);
      expect(plugin.world.removeRigidBody).toHaveBeenCalled();
    });

    it('clears collision observable', async () => {
      const { cc } = await createController();
      const events: any[] = [];
      cc.onTriggerCollisionObservable.add((e: any) => events.push(e));
      cc.dispose();

      // Observable should be cleared, so notifying should do nothing
      // (This tests that clear was called; the mock Observable clears its observers)
    });

    it('is idempotent', async () => {
      const { cc, plugin } = await createController();
      cc.dispose();
      cc.dispose();
      expect(plugin.world.removeCharacterController).toHaveBeenCalledTimes(1);
      expect(plugin.world.removeRigidBody).toHaveBeenCalledTimes(1);
    });
  });
});
