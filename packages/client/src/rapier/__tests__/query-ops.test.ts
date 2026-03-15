import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhysicsShapeType } from '@babylonjs/core';
import type { RapierPluginState } from '../types.js';
import { raycast, shapeCast, shapeProximity, pointProximity } from '../query-ops.js';

// --- Mock @babylonjs/core ---

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    subtract(o: Vector3) { return new Vector3(this.x - o.x, this.y - o.y, this.z - o.z); }
    length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
    normalize() {
      const l = this.length();
      return l > 0 ? new Vector3(this.x / l, this.y / l, this.z / l) : new Vector3();
    }
  }
  return {
    Vector3,
    PhysicsShapeType: { BOX: 0, SPHERE: 1, CAPSULE: 2, CYLINDER: 3, CONVEX_HULL: 4, MESH: 5, HEIGHTFIELD: 6 },
  };
});

vi.mock('@babylonjs/core/Physics/shapeCastResult', () => ({
  ShapeCastResult: class {
    body: any = null; shape: any = null;
    setHitData = vi.fn();
    setHitFraction = vi.fn();
  },
}));

vi.mock('@babylonjs/core/Physics/proximityCastResult', () => ({
  ProximityCastResult: class {
    body: any = null; shape: any = null;
    setHitData = vi.fn();
    setHitDistance = vi.fn();
  },
}));

// --- Helpers ---

function makeRapier() {
  return {
    Vector3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
    Quaternion: class { constructor(public x = 0, public y = 0, public z = 0, public w = 1) {} },
    Ray: class {
      origin: any; dir: any;
      constructor(origin: any, dir: any) { this.origin = origin; this.dir = dir; }
      pointAt(t: number) {
        return { x: this.origin.x + this.dir.x * t, y: this.origin.y + this.dir.y * t, z: this.origin.z + this.dir.z * t };
      }
    },
    Cuboid: class { constructor(public hx: number, public hy: number, public hz: number) {} },
    Ball: class { constructor(public radius: number) {} },
    Capsule: class { constructor(public halfHeight: number, public radius: number) {} },
    Cylinder: class { constructor(public halfHeight: number, public radius: number) {} },
    ConvexPolyhedron: class { constructor(public vertices: any, public indices: any) {} },
    QueryFilterFlags: { EXCLUDE_SENSORS: 1 },
  } as any;
}

function makeState(overrides: Partial<RapierPluginState> = {}): RapierPluginState {
  return {
    rapier: makeRapier(),
    world: {
      castRayAndGetNormal: vi.fn(),
      castShape: vi.fn(),
      projectPoint: vi.fn(),
    } as any,
    shapeTypeMap: new Map(),
    shapeToColliderDesc: new Map(),
    shapeRawData: new Map(),
    bodyToRigidBody: new Map(),
    colliderHandleToBody: new Map(),
    bodyToShape: new Map(),
    ...overrides,
  } as any;
}

function v3(x: number, y: number, z: number) {
  const { Vector3 } = require('@babylonjs/core');
  return new Vector3(x, y, z);
}

// --- Tests ---

describe('query-ops (rapier)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('raycast', () => {
    it('calls castRayAndGetNormal and sets hit data on result', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue({
        timeOfImpact: 2.5,
        normal: { x: 0, y: 1, z: 0 },
      });

      const result = {
        setHitData: vi.fn(),
        calculateHitDistance: vi.fn(),
        reset: vi.fn(),
      } as any;

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), result);

      expect(state.world.castRayAndGetNormal).toHaveBeenCalled();
      expect(result.setHitData).toHaveBeenCalled();
      expect(result.calculateHitDistance).toHaveBeenCalled();
    });

    it('does nothing when no hit', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue(null);

      const result = { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any;

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), result);

      expect(result.setHitData).not.toHaveBeenCalled();
    });

    it('applies filter flags when shouldHitTriggers is false', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue(null);
      const result = { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any;

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), result, { shouldHitTriggers: false } as any);

      const call = (state.world.castRayAndGetNormal as any).mock.calls[0];
      // filterFlags arg (4th positional)
      expect(call[3]).toBe(1); // EXCLUDE_SENSORS
    });

    it('applies filter groups from membership and collideWith', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue(null);
      const result = { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any;

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), result, { membership: 0x0001, collideWith: 0x0002 } as any);

      const call = (state.world.castRayAndGetNormal as any).mock.calls[0];
      // filterGroups = (0x0001 << 16) | 0x0002
      expect(call[4]).toBe((0x0001 << 16) | 0x0002);
    });

    it('resets result before raycast', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue(null);
      const result = { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any;

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), result);

      expect(result.reset).toHaveBeenCalled();
    });

    it('handles array of results using intersectionsWithRay for multi-hit', () => {
      const state = makeState();

      const mockBody = {} as any;
      const mockShape = {} as any;
      state.colliderHandleToBody.set(10, mockBody);
      state.bodyToShape.set(mockBody, mockShape);

      (state.world as any).intersectionsWithRay = vi.fn((ray: any, maxToi: any, solid: any, callback: any) => {
        callback({ timeOfImpact: 2, normal: { x: 0, y: 1, z: 0 }, collider: { handle: 10 } });
        callback({ timeOfImpact: 5, normal: { x: 1, y: 0, z: 0 }, collider: { handle: 10 } });
      });

      const results = [
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn(), _body: null } as any,
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn(), _body: null } as any,
      ];

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), results);

      expect((state.world as any).intersectionsWithRay).toHaveBeenCalled();
      expect(results[0].setHitData).toHaveBeenCalled();
      expect(results[0].calculateHitDistance).toHaveBeenCalled();
      expect(results[1].setHitData).toHaveBeenCalled();
      expect(results[1].calculateHitDistance).toHaveBeenCalled();
      expect(results[0]._body).toBe(mockBody);
      expect(results[1]._body).toBe(mockBody);
    });

    it('stops collecting multi-hit results when array is full', () => {
      const state = makeState();

      (state.world as any).intersectionsWithRay = vi.fn((ray: any, maxToi: any, solid: any, callback: any) => {
        const cont1 = callback({ timeOfImpact: 2, normal: { x: 0, y: 1, z: 0 }, collider: { handle: 1 } });
        expect(cont1).toBe(true);
        const cont2 = callback({ timeOfImpact: 5, normal: { x: 1, y: 0, z: 0 }, collider: { handle: 2 } });
        expect(cont2).toBe(true);
        // Array is now full (2 slots filled), next call should return false
        const cont3 = callback({ timeOfImpact: 8, normal: { x: 0, y: 0, z: 1 }, collider: { handle: 3 } });
        expect(cont3).toBe(false);
      });

      const results = [
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
      ];

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), results);

      expect(results[0].setHitData).toHaveBeenCalled();
      expect(results[1].setHitData).toHaveBeenCalled();
    });

    it('resets all results in array', () => {
      const state = makeState();
      (state.world as any).intersectionsWithRay = vi.fn();

      const results = [
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
      ];

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), results);

      for (const r of results) {
        expect(r.reset).toHaveBeenCalled();
      }
    });

    it('handles empty array without error', () => {
      const state = makeState();
      (state.world as any).intersectionsWithRay = vi.fn();

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), []);

      expect((state.world as any).intersectionsWithRay).toHaveBeenCalled();
    });

    it('uses single-hit path for array with length 1', () => {
      const state = makeState();
      (state.world.castRayAndGetNormal as any).mockReturnValue({
        timeOfImpact: 3,
        normal: { x: 0, y: 1, z: 0 },
      });

      const results = [
        { setHitData: vi.fn(), calculateHitDistance: vi.fn(), reset: vi.fn() } as any,
      ];

      raycast(state, v3(0, 0, 0), v3(0, 10, 0), results);

      expect(state.world.castRayAndGetNormal).toHaveBeenCalled();
      expect(results[0].setHitData).toHaveBeenCalled();
    });
  });

  describe('shapeCast', () => {
    it('returns early if shape is unsupported', () => {
      const state = makeState();
      const query = {
        shape: {},
        startPosition: v3(0, 0, 0),
        endPosition: v3(0, 10, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as any;
      const inputResult = { setHitData: vi.fn(), setHitFraction: vi.fn() } as any;
      const hitResult = { setHitData: vi.fn(), setHitFraction: vi.fn() } as any;

      shapeCast(state, query, inputResult, hitResult);

      expect(state.world.castShape).not.toHaveBeenCalled();
    });

    it('returns early when maxToi is 0', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.BOX);
      state.shapeToColliderDesc.set(shape, { halfExtents: { x: 1, y: 1, z: 1 } } as any);

      const query = {
        shape,
        startPosition: v3(5, 5, 5),
        endPosition: v3(5, 5, 5), // same = zero distance
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as any;

      shapeCast(state, query, {} as any, {} as any);

      expect(state.world.castShape).not.toHaveBeenCalled();
    });

    it('sets hit data on both results when hit found', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.SPHERE);
      state.shapeToColliderDesc.set(shape, { radius: 1 } as any);

      const mockBody = {} as any;
      const mockShape = {} as any;
      state.colliderHandleToBody.set(42, mockBody);
      state.bodyToShape.set(mockBody, mockShape);

      (state.world.castShape as any).mockReturnValue({
        time_of_impact: 3,
        normal1: { x: 0, y: 1, z: 0 },
        normal2: { x: 0, y: -1, z: 0 },
        witness1: { x: 0, y: 3, z: 0 },
        witness2: { x: 0, y: 3, z: 0 },
        collider: { handle: 42 },
      });

      const query = {
        shape,
        startPosition: v3(0, 0, 0),
        endPosition: v3(0, 10, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as any;

      const inputResult = { setHitData: vi.fn(), setHitFraction: vi.fn() } as any;
      const hitResult = { setHitData: vi.fn(), setHitFraction: vi.fn(), body: null, shape: null } as any;

      shapeCast(state, query, inputResult, hitResult);

      expect(inputResult.setHitData).toHaveBeenCalled();
      expect(inputResult.setHitFraction).toHaveBeenCalledWith(0.3);
      expect(hitResult.setHitData).toHaveBeenCalled();
      expect(hitResult.body).toBe(mockBody);
      expect(hitResult.shape).toBe(mockShape);
    });

    it('excludes ignoreBody rigid body', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.SPHERE);
      state.shapeToColliderDesc.set(shape, { radius: 1 } as any);

      const ignoreBody = {} as any;
      const rb = {} as any;
      state.bodyToRigidBody.set(ignoreBody, rb);
      (state.world.castShape as any).mockReturnValue(null);

      const query = {
        shape,
        startPosition: v3(0, 0, 0),
        endPosition: v3(0, 10, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        ignoreBody,
      } as any;

      shapeCast(state, query, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any);

      const call = (state.world.castShape as any).mock.calls[0];
      expect(call[call.length - 1]).toBe(rb);
    });
  });

  describe('createRapierShape (via shapeCast)', () => {
    const shapeTypes = [
      { type: PhysicsShapeType.BOX, desc: { halfExtents: { x: 1, y: 2, z: 3 } }, name: 'box' },
      { type: PhysicsShapeType.SPHERE, desc: { radius: 5 }, name: 'sphere' },
      { type: PhysicsShapeType.CAPSULE, desc: { radius: 1, halfHeight: 2 }, name: 'capsule' },
      { type: PhysicsShapeType.CYLINDER, desc: { radius: 1, halfHeight: 3 }, name: 'cylinder' },
    ];

    for (const { type, desc, name } of shapeTypes) {
      it(`creates ${name} shape`, () => {
        const state = makeState();
        const shape = {} as any;
        state.shapeTypeMap.set(shape, type);
        state.shapeToColliderDesc.set(shape, desc as any);
        (state.world.castShape as any).mockReturnValue(null);

        const query = {
          shape,
          startPosition: v3(0, 0, 0),
          endPosition: v3(0, 10, 0),
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        } as any;

        shapeCast(state, query, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any);

        expect(state.world.castShape).toHaveBeenCalled();
      });
    }

    it('creates convex hull shape from raw data', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.CONVEX_HULL);
      state.shapeToColliderDesc.set(shape, {} as any);
      state.shapeRawData.set(shape, { vertices: new Float32Array([0, 1, 2]) } as any);
      (state.world.castShape as any).mockReturnValue(null);

      const query = {
        shape,
        startPosition: v3(0, 0, 0),
        endPosition: v3(0, 10, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as any;

      shapeCast(state, query, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any);

      expect(state.world.castShape).toHaveBeenCalled();
    });

    it('returns null for mesh shape type', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.MESH);
      state.shapeToColliderDesc.set(shape, {} as any);

      const query = {
        shape,
        startPosition: v3(0, 0, 0),
        endPosition: v3(0, 10, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as any;

      shapeCast(state, query, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any, { setHitData: vi.fn(), setHitFraction: vi.fn() } as any);

      expect(state.world.castShape).not.toHaveBeenCalled();
    });
  });

  describe('shapeProximity', () => {
    it('returns early if shape unsupported', () => {
      const state = makeState();
      shapeProximity(state, { shape: {}, position: v3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, maxDistance: 10 } as any, {} as any, {} as any);
      expect(state.world.castShape).not.toHaveBeenCalled();
    });

    it('sets hit data on both results when hit found', () => {
      const state = makeState();
      const shape = {} as any;
      state.shapeTypeMap.set(shape, PhysicsShapeType.SPHERE);
      state.shapeToColliderDesc.set(shape, { radius: 1 } as any);

      (state.world.castShape as any).mockReturnValue({
        time_of_impact: 2,
        normal1: { x: 1, y: 0, z: 0 },
        normal2: { x: -1, y: 0, z: 0 },
        witness1: { x: 3, y: 0, z: 0 },
        witness2: { x: 4, y: 0, z: 0 },
        collider: { handle: 10 },
      });

      const mockBody = {} as any;
      const mockShape = {} as any;
      state.colliderHandleToBody.set(10, mockBody);
      state.bodyToShape.set(mockBody, mockShape);

      const inputResult = { setHitData: vi.fn(), setHitDistance: vi.fn() } as any;
      const hitResult = { setHitData: vi.fn(), setHitDistance: vi.fn(), body: null, shape: null } as any;

      shapeProximity(state, { shape, position: v3(0, 0, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, maxDistance: 10 } as any, inputResult, hitResult);

      expect(inputResult.setHitData).toHaveBeenCalled();
      expect(inputResult.setHitDistance).toHaveBeenCalledWith(2);
      expect(hitResult.body).toBe(mockBody);
      expect(hitResult.shape).toBe(mockShape);
    });
  });

  describe('pointProximity', () => {
    it('does nothing when no projection', () => {
      const state = makeState();
      (state.world.projectPoint as any).mockReturnValue(null);

      const result = { setHitData: vi.fn(), setHitDistance: vi.fn() } as any;
      pointProximity(state, { position: v3(0, 0, 0), maxDistance: 10 } as any, result);

      expect(result.setHitData).not.toHaveBeenCalled();
    });

    it('does nothing when distance exceeds maxDistance', () => {
      const state = makeState();
      (state.world.projectPoint as any).mockReturnValue({
        point: { x: 100, y: 0, z: 0 },
        collider: { handle: 1 },
      });

      const result = { setHitData: vi.fn(), setHitDistance: vi.fn() } as any;
      pointProximity(state, { position: v3(0, 0, 0), maxDistance: 5 } as any, result);

      expect(result.setHitData).not.toHaveBeenCalled();
    });

    it('sets hit data when within maxDistance', () => {
      const state = makeState();
      const mockBody = {} as any;
      const mockShape = {} as any;
      state.colliderHandleToBody.set(7, mockBody);
      state.bodyToShape.set(mockBody, mockShape);

      (state.world.projectPoint as any).mockReturnValue({
        point: { x: 1, y: 0, z: 0 },
        collider: { handle: 7 },
      });

      const result = { setHitData: vi.fn(), setHitDistance: vi.fn(), body: null, shape: null } as any;
      pointProximity(state, { position: v3(0, 0, 0), maxDistance: 5 } as any, result);

      expect(result.setHitData).toHaveBeenCalled();
      expect(result.setHitDistance).toHaveBeenCalledWith(1);
      expect(result.body).toBe(mockBody);
      expect(result.shape).toBe(mockShape);
    });

    it('uses default normal when distance is 0', () => {
      const state = makeState();
      (state.world.projectPoint as any).mockReturnValue({
        point: { x: 5, y: 5, z: 5 },
        collider: { handle: 1 },
      });

      const result = { setHitData: vi.fn(), setHitDistance: vi.fn() } as any;
      pointProximity(state, { position: v3(5, 5, 5), maxDistance: 10 } as any, result);

      expect(result.setHitData).toHaveBeenCalled();
      // Normal should be (0, 1, 0) when dist = 0
      const normalArg = result.setHitData.mock.calls[0][0];
      expect(normalArg.x).toBe(0);
      expect(normalArg.y).toBe(1);
      expect(normalArg.z).toBe(0);
    });

    it('excludes ignoreBody', () => {
      const state = makeState();
      const ignoreBody = {} as any;
      const rb = {} as any;
      state.bodyToRigidBody.set(ignoreBody, rb);
      (state.world.projectPoint as any).mockReturnValue(null);

      pointProximity(state, { position: v3(0, 0, 0), maxDistance: 10, ignoreBody } as any, {} as any);

      const call = (state.world.projectPoint as any).mock.calls[0];
      expect(call[call.length - 1]).toBe(rb);
    });
  });
});
