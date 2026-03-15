import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhysicsMotionType } from '@babylonjs/core';
import type { RapierPluginState } from '../types.js';
import {
  initBody,
  disposeBody,
  syncBody,
  syncTransform,
  setMotionType,
  getMotionType,
  computeMassProperties,
  setMassProperties,
  getMassProperties,
  setLinearDamping,
  getLinearDamping,
  setAngularDamping,
  getAngularDamping,
  setLinearVelocity,
  getLinearVelocityToRef,
  setAngularVelocity,
  getAngularVelocityToRef,
  applyImpulse,
  applyAngularImpulse,
  applyForce,
  applyTorque,
  setGravityFactor,
  getGravityFactor,
  setTargetTransform,
  setPhysicsBodyTransformation,
  setActivationControl,
} from '../body-ops.js';

// --- Minimal Rapier mocks ---

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

function makeMockRigidBody(overrides: Record<string, any> = {}) {
  return {
    translation: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    linvel: vi.fn(() => ({ x: 4, y: 5, z: 6 })),
    angvel: vi.fn(() => ({ x: 7, y: 8, z: 9 })),
    mass: vi.fn(() => 10),
    localCom: vi.fn(() => ({ x: 0.1, y: 0.2, z: 0.3 })),
    principalInertia: vi.fn(() => ({ x: 1, y: 1, z: 1 })),
    principalInertiaLocalFrame: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    handle: 42,
    enableCcd: vi.fn(),
    setTranslation: vi.fn(),
    setRotation: vi.fn(),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
    setLinearDamping: vi.fn(),
    linearDamping: vi.fn(() => 0.5),
    setAngularDamping: vi.fn(),
    angularDamping: vi.fn(() => 0.8),
    setAdditionalMassProperties: vi.fn(),
    applyImpulseAtPoint: vi.fn(),
    applyTorqueImpulse: vi.fn(),
    addForceAtPoint: vi.fn(),
    addTorque: vi.fn(),
    setGravityScale: vi.fn(),
    gravityScale: vi.fn(() => 1.5),
    setBodyType: vi.fn(),
    isDynamic: vi.fn(() => true),
    isKinematic: vi.fn(() => false),
    isFixed: vi.fn(() => false),
    setNextKinematicTranslation: vi.fn(),
    setNextKinematicRotation: vi.fn(),
    ...overrides,
  } as any;
}

function makeBjsVector3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set: vi.fn(),
    clone: () => makeBjsVector3(x, y, z),
  } as any;
}

function makeBjsQuaternion(x = 0, y = 0, z = 0, w = 1) {
  return {
    x, y, z, w,
    set: vi.fn(),
    clone: () => makeBjsQuaternion(x, y, z, w),
  } as any;
}

function makeMockBody(name: string) {
  return {
    transformNode: {
      name,
      position: makeBjsVector3(),
      rotationQuaternion: null as any,
    },
    _pluginData: {},
    shape: null,
  } as any;
}

function makeMockShape() {
  return {} as any;
}

function makeState(overrides: Partial<RapierPluginState> = {}): RapierPluginState {
  return {
    rapier: {
      RigidBodyDesc: {
        dynamic: vi.fn(() => ({
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        })),
        fixed: vi.fn(() => ({
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        })),
        kinematicPositionBased: vi.fn(() => ({
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        })),
      },
      RigidBodyType: {
        Dynamic: 0,
        Fixed: 1,
        KinematicPositionBased: 2,
      },
      Vector3: MockVector3,
      Quaternion: MockQuaternion,
    } as any,
    world: {
      createRigidBody: vi.fn(() => makeMockRigidBody()),
      removeRigidBody: vi.fn(),
    } as any,
    bodyToRigidBody: new Map(),
    bodyToColliders: new Map(),
    shapeToColliderDesc: new Map(),
    shapeTypeMap: new Map(),
    shapeMaterialMap: new Map(),
    shapeDensityMap: new Map(),
    shapeFilterMembership: new Map(),
    shapeFilterCollide: new Map(),
    shapeRawData: new Map(),
    bodyCollisionObservables: new Map(),
    bodyCollisionEndedObservables: new Map(),
    constraintToJoint: new Map(),
    constraintBodies: new Map(),
    constraintAxisState: new Map(),
    constraintEnabled: new Map(),
    constraintDescriptors: new Map(),
    collisionCallbackEnabled: new Set(),
    collisionEndedCallbackEnabled: new Set(),
    triggerShapes: new Set(),
    bodyIdToPhysicsBody: new Map(),
    bodyToShape: new Map(),
    shapeToBody: new Map(),
    compoundChildren: new Map(),
    bodyEventMask: new Map(),
    colliderHandleToBody: new Map(),
    bodyToInstanceRigidBodies: new Map(),
    bodyToInstanceColliders: new Map(),
    activeCollisionPairs: new Set(),
    onCollisionObservable: { notifyObservers: vi.fn() } as any,
    onCollisionEndedObservable: { notifyObservers: vi.fn() } as any,
    onTriggerCollisionObservable: { notifyObservers: vi.fn() } as any,
    ...overrides,
  };
}

describe('initBody', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should create a dynamic rigid body', () => {
    const body = makeMockBody('dyn');
    const pos = makeBjsVector3(1, 2, 3);
    const rot = makeBjsQuaternion(0, 0, 0, 1);

    initBody(state, body, PhysicsMotionType.DYNAMIC, pos, rot);

    expect(state.rapier.RigidBodyDesc.dynamic).toHaveBeenCalled();
    expect(state.world.createRigidBody).toHaveBeenCalled();
    expect(state.bodyToRigidBody.has(body)).toBe(true);
    expect(state.bodyToColliders.get(body)).toEqual([]);
  });

  it('should create a static (fixed) rigid body', () => {
    const body = makeMockBody('stat');
    initBody(state, body, PhysicsMotionType.STATIC, makeBjsVector3(), makeBjsQuaternion());
    expect(state.rapier.RigidBodyDesc.fixed).toHaveBeenCalled();
  });

  it('should create a kinematic rigid body for ANIMATED', () => {
    const body = makeMockBody('kin');
    initBody(state, body, PhysicsMotionType.ANIMATED, makeBjsVector3(), makeBjsQuaternion());
    expect(state.rapier.RigidBodyDesc.kinematicPositionBased).toHaveBeenCalled();
  });

  it('should enable CCD only for dynamic bodies', () => {
    const rb = makeMockRigidBody();
    state.world.createRigidBody = vi.fn(() => rb);

    const dynBody = makeMockBody('dyn');
    initBody(state, dynBody, PhysicsMotionType.DYNAMIC, makeBjsVector3(), makeBjsQuaternion());
    expect(rb.enableCcd).toHaveBeenCalledWith(true);

    rb.enableCcd.mockClear();
    const statBody = makeMockBody('stat');
    initBody(state, statBody, PhysicsMotionType.STATIC, makeBjsVector3(), makeBjsQuaternion());
    expect(rb.enableCcd).not.toHaveBeenCalled();
  });

  it('should set translation and rotation on the body desc', () => {
    const body = makeMockBody('tr');
    const pos = makeBjsVector3(5, 6, 7);
    const rot = makeBjsQuaternion(0.1, 0.2, 0.3, 0.9);

    initBody(state, body, PhysicsMotionType.DYNAMIC, pos, rot);

    const desc = (state.rapier.RigidBodyDesc.dynamic as any).mock.results[0].value;
    expect(desc.setTranslation).toHaveBeenCalledWith(5, 6, 7);
    expect(desc.setRotation).toHaveBeenCalled();
  });

  it('should default to dynamic for unknown motion type', () => {
    const body = makeMockBody('unk');
    initBody(state, body, 99 as any, makeBjsVector3(), makeBjsQuaternion());
    expect(state.rapier.RigidBodyDesc.dynamic).toHaveBeenCalled();
  });
});

describe('disposeBody', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should remove rigid body and clean up all maps', () => {
    const body = makeMockBody('disp');
    const rb = makeMockRigidBody();
    const shape = makeMockShape();
    const collider = { handle: 10 } as any;

    state.bodyToRigidBody.set(body, rb);
    state.bodyToColliders.set(body, [collider]);
    state.colliderHandleToBody.set(10, body);
    state.bodyCollisionObservables.set(body, {} as any);
    state.bodyCollisionEndedObservables.set(body, {} as any);
    state.collisionCallbackEnabled.add(body);
    state.collisionEndedCallbackEnabled.add(body);
    state.bodyToShape.set(body, shape);
    state.shapeToBody.set(shape, body);
    state.bodyEventMask.set(body, 1);

    disposeBody(state, body);

    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb);
    expect(state.bodyToRigidBody.has(body)).toBe(false);
    expect(state.bodyToColliders.has(body)).toBe(false);
    expect(state.colliderHandleToBody.has(10)).toBe(false);
    expect(state.bodyCollisionObservables.has(body)).toBe(false);
    expect(state.bodyCollisionEndedObservables.has(body)).toBe(false);
    expect(state.collisionCallbackEnabled.has(body)).toBe(false);
    expect(state.collisionEndedCallbackEnabled.has(body)).toBe(false);
    expect(state.bodyToShape.has(body)).toBe(false);
    expect(state.shapeToBody.has(shape)).toBe(false);
    expect(state.bodyEventMask.has(body)).toBe(false);
  });

  it('should be a no-op when body has no rigid body mapping', () => {
    const body = makeMockBody('missing');
    disposeBody(state, body);
    expect(state.world.removeRigidBody).not.toHaveBeenCalled();
  });

  it('should handle body with no shape mapping', () => {
    const body = makeMockBody('no-shape');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);
    state.bodyToColliders.set(body, []);

    disposeBody(state, body);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb);
    expect(state.bodyToRigidBody.has(body)).toBe(false);
  });

  it('should remove multiple collider handle mappings', () => {
    const body = makeMockBody('multi-col');
    const rb = makeMockRigidBody();
    const col1 = { handle: 1 } as any;
    const col2 = { handle: 2 } as any;
    const col3 = { handle: 3 } as any;

    state.bodyToRigidBody.set(body, rb);
    state.bodyToColliders.set(body, [col1, col2, col3]);
    state.colliderHandleToBody.set(1, body);
    state.colliderHandleToBody.set(2, body);
    state.colliderHandleToBody.set(3, body);

    disposeBody(state, body);

    expect(state.colliderHandleToBody.has(1)).toBe(false);
    expect(state.colliderHandleToBody.has(2)).toBe(false);
    expect(state.colliderHandleToBody.has(3)).toBe(false);
  });
});

describe('syncBody', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should copy rigid body position and rotation to the transform node', () => {
    const body = makeMockBody('sync');
    const rb = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 10, y: 20, z: 30 })),
      rotation: vi.fn(() => ({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 })),
    });
    state.bodyToRigidBody.set(body, rb);

    syncBody(state, body);

    expect(body.transformNode.position.set).toHaveBeenCalledWith(10, 20, 30);
    // rotationQuaternion should have been created since it was null
    expect(body.transformNode.rotationQuaternion).not.toBeNull();
  });

  it('should be a no-op when no rigid body is mapped', () => {
    const body = makeMockBody('no-rb');
    syncBody(state, body);
    expect(body.transformNode.position.set).not.toHaveBeenCalled();
  });

  it('should be a no-op when body has no transformNode', () => {
    const body = { transformNode: null } as any;
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);
    // Should not throw
    syncBody(state, body);
  });

  it('should reuse existing rotationQuaternion if present', () => {
    const body = makeMockBody('reuse-rot');
    const existingQuat = makeBjsQuaternion(0, 0, 0, 1);
    body.transformNode.rotationQuaternion = existingQuat;

    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    syncBody(state, body);

    // Should have called set on the existing quaternion
    expect(existingQuat.set).toHaveBeenCalled();
    expect(body.transformNode.rotationQuaternion).toBe(existingQuat);
  });
});

describe('syncTransform', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should sync rigid body transform to an arbitrary TransformNode', () => {
    const body = makeMockBody('body');
    const rb = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 5, y: 6, z: 7 })),
      rotation: vi.fn(() => ({ x: 0, y: 0.7, z: 0, w: 0.7 })),
    });
    state.bodyToRigidBody.set(body, rb);

    const targetNode = {
      position: makeBjsVector3(),
      rotationQuaternion: null as any,
    } as any;

    syncTransform(state, body, targetNode);

    expect(targetNode.position.set).toHaveBeenCalledWith(5, 6, 7);
    expect(targetNode.rotationQuaternion).not.toBeNull();
  });

  it('should be a no-op when no rigid body is mapped', () => {
    const body = makeMockBody('missing');
    const targetNode = { position: makeBjsVector3(), rotationQuaternion: null } as any;

    syncTransform(state, body, targetNode);
    expect(targetNode.position.set).not.toHaveBeenCalled();
  });
});

describe('setMotionType / getMotionType', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should set body type to Dynamic', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    setMotionType(state, body, PhysicsMotionType.DYNAMIC);
    expect(rb.setBodyType).toHaveBeenCalledWith(state.rapier.RigidBodyType.Dynamic, true);
  });

  it('should set body type to Fixed (STATIC)', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    setMotionType(state, body, PhysicsMotionType.STATIC);
    expect(rb.setBodyType).toHaveBeenCalledWith(state.rapier.RigidBodyType.Fixed, true);
  });

  it('should set body type to KinematicPositionBased (ANIMATED)', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    setMotionType(state, body, PhysicsMotionType.ANIMATED);
    expect(rb.setBodyType).toHaveBeenCalledWith(state.rapier.RigidBodyType.KinematicPositionBased, true);
  });

  it('getMotionType should return DYNAMIC for dynamic bodies', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody({ isDynamic: vi.fn(() => true), isKinematic: vi.fn(() => false) });
    state.bodyToRigidBody.set(body, rb);

    expect(getMotionType(state, body)).toBe(PhysicsMotionType.DYNAMIC);
  });

  it('getMotionType should return ANIMATED for kinematic bodies', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody({ isDynamic: vi.fn(() => false), isKinematic: vi.fn(() => true) });
    state.bodyToRigidBody.set(body, rb);

    expect(getMotionType(state, body)).toBe(PhysicsMotionType.ANIMATED);
  });

  it('getMotionType should return STATIC for fixed bodies', () => {
    const body = makeMockBody('mt');
    const rb = makeMockRigidBody({ isDynamic: vi.fn(() => false), isKinematic: vi.fn(() => false) });
    state.bodyToRigidBody.set(body, rb);

    expect(getMotionType(state, body)).toBe(PhysicsMotionType.STATIC);
  });

  it('getMotionType should return STATIC when no rigid body exists', () => {
    const body = makeMockBody('missing');
    expect(getMotionType(state, body)).toBe(PhysicsMotionType.STATIC);
  });

  it('setMotionType should be a no-op when no rigid body exists', () => {
    const body = makeMockBody('missing');
    setMotionType(state, body, PhysicsMotionType.DYNAMIC);
    // no error thrown
  });
});

describe('computeMassProperties / getMassProperties', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should return mass properties from the rigid body', () => {
    const body = makeMockBody('mass');
    const rb = makeMockRigidBody({
      mass: vi.fn(() => 25),
      localCom: vi.fn(() => ({ x: 0.5, y: 0.6, z: 0.7 })),
      principalInertia: vi.fn(() => ({ x: 2, y: 3, z: 4 })),
      principalInertiaLocalFrame: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    });
    state.bodyToRigidBody.set(body, rb);

    const props = computeMassProperties(state, body);
    expect(props.mass).toBe(25);
    expect(props.centerOfMass!.x).toBe(0.5);
    expect(props.centerOfMass!.y).toBe(0.6);
    expect(props.centerOfMass!.z).toBe(0.7);
    expect(props.inertia!.x).toBe(2);
    expect(props.inertia!.y).toBe(3);
    expect(props.inertia!.z).toBe(4);
  });

  it('should return defaults when no rigid body is mapped', () => {
    const body = makeMockBody('no-rb');
    const props = computeMassProperties(state, body);
    expect(props.mass).toBe(1);
  });

  it('getMassProperties should match computeMassProperties', () => {
    const body = makeMockBody('gmp');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    const compute = computeMassProperties(state, body);
    const get = getMassProperties(state, body);
    expect(compute.mass).toBe(get.mass);
  });
});

describe('setMassProperties', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('should call setAdditionalMassProperties on the rigid body', () => {
    const body = makeMockBody('smp');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    setMassProperties(state, body, {
      mass: 50,
      centerOfMass: makeBjsVector3(1, 2, 3),
      inertia: makeBjsVector3(4, 5, 6),
      inertiaOrientation: makeBjsQuaternion(0, 0, 0, 1),
    } as any);

    expect(rb.setAdditionalMassProperties).toHaveBeenCalledWith(
      50,
      expect.any(MockVector3),
      expect.any(MockVector3),
      expect.any(MockQuaternion),
      true,
    );
  });

  it('should default missing mass properties', () => {
    const body = makeMockBody('def');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    setMassProperties(state, body, {} as any);

    expect(rb.setAdditionalMassProperties).toHaveBeenCalledWith(
      0,
      expect.any(MockVector3),
      expect.any(MockVector3),
      expect.any(MockQuaternion),
      true,
    );
  });

  it('should be a no-op when no rigid body exists', () => {
    const body = makeMockBody('missing');
    setMassProperties(state, body, { mass: 10 } as any);
    // no error
  });
});

describe('damping', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('damp');
    state.bodyToRigidBody.set(body, rb);
  });

  it('setLinearDamping should call rb.setLinearDamping', () => {
    setLinearDamping(state, body, 0.3);
    expect(rb.setLinearDamping).toHaveBeenCalledWith(0.3);
  });

  it('getLinearDamping should return rb.linearDamping()', () => {
    expect(getLinearDamping(state, body)).toBe(0.5);
  });

  it('getLinearDamping should return 0 when no rigid body exists', () => {
    expect(getLinearDamping(state, makeMockBody('x'))).toBe(0);
  });

  it('setAngularDamping should call rb.setAngularDamping', () => {
    setAngularDamping(state, body, 0.9);
    expect(rb.setAngularDamping).toHaveBeenCalledWith(0.9);
  });

  it('getAngularDamping should return rb.angularDamping()', () => {
    expect(getAngularDamping(state, body)).toBe(0.8);
  });

  it('getAngularDamping should return 0 when no rigid body exists', () => {
    expect(getAngularDamping(state, makeMockBody('x'))).toBe(0);
  });
});

describe('velocity', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('vel');
    state.bodyToRigidBody.set(body, rb);
  });

  it('setLinearVelocity should call rb.setLinvel with Rapier Vector3', () => {
    setLinearVelocity(state, body, makeBjsVector3(1, 2, 3));
    expect(rb.setLinvel).toHaveBeenCalled();
    const vec = rb.setLinvel.mock.calls[0][0];
    expect(vec.x).toBe(1);
    expect(vec.y).toBe(2);
    expect(vec.z).toBe(3);
  });

  it('getLinearVelocityToRef should write velocity into ref vector', () => {
    const ref = makeBjsVector3();
    getLinearVelocityToRef(state, body, ref);
    expect(ref.set).toHaveBeenCalledWith(4, 5, 6);
  });

  it('getLinearVelocityToRef should be a no-op when no rigid body exists', () => {
    const ref = makeBjsVector3();
    getLinearVelocityToRef(state, makeMockBody('x'), ref);
    expect(ref.set).not.toHaveBeenCalled();
  });

  it('setAngularVelocity should call rb.setAngvel with Rapier Vector3', () => {
    setAngularVelocity(state, body, makeBjsVector3(10, 20, 30));
    expect(rb.setAngvel).toHaveBeenCalled();
    const vec = rb.setAngvel.mock.calls[0][0];
    expect(vec.x).toBe(10);
    expect(vec.y).toBe(20);
    expect(vec.z).toBe(30);
  });

  it('getAngularVelocityToRef should write angular velocity into ref vector', () => {
    const ref = makeBjsVector3();
    getAngularVelocityToRef(state, body, ref);
    expect(ref.set).toHaveBeenCalledWith(7, 8, 9);
  });
});

describe('forces and impulses', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('force');
    state.bodyToRigidBody.set(body, rb);
  });

  it('applyImpulse should call rb.applyImpulseAtPoint', () => {
    applyImpulse(state, body, makeBjsVector3(1, 0, 0), makeBjsVector3(0, 1, 0));
    expect(rb.applyImpulseAtPoint).toHaveBeenCalled();
    const impulseArg = rb.applyImpulseAtPoint.mock.calls[0][0];
    const locationArg = rb.applyImpulseAtPoint.mock.calls[0][1];
    expect(impulseArg.x).toBe(1);
    expect(locationArg.y).toBe(1);
  });

  it('applyImpulse should be a no-op when no rigid body exists', () => {
    applyImpulse(state, makeMockBody('x'), makeBjsVector3(), makeBjsVector3());
    // no error
  });

  it('applyAngularImpulse should call rb.applyTorqueImpulse', () => {
    applyAngularImpulse(state, body, makeBjsVector3(0, 5, 0));
    expect(rb.applyTorqueImpulse).toHaveBeenCalled();
    const arg = rb.applyTorqueImpulse.mock.calls[0][0];
    expect(arg.y).toBe(5);
  });

  it('applyForce should call rb.addForceAtPoint', () => {
    applyForce(state, body, makeBjsVector3(10, 0, 0), makeBjsVector3(0, 0, 5));
    expect(rb.addForceAtPoint).toHaveBeenCalled();
    const forceArg = rb.addForceAtPoint.mock.calls[0][0];
    const locArg = rb.addForceAtPoint.mock.calls[0][1];
    expect(forceArg.x).toBe(10);
    expect(locArg.z).toBe(5);
  });

  it('applyTorque should call rb.addTorque', () => {
    applyTorque(state, body, makeBjsVector3(0, 0, 100));
    expect(rb.addTorque).toHaveBeenCalled();
    const arg = rb.addTorque.mock.calls[0][0];
    expect(arg.z).toBe(100);
  });
});

describe('gravity factor', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('grav');
    state.bodyToRigidBody.set(body, rb);
  });

  it('setGravityFactor should call rb.setGravityScale', () => {
    setGravityFactor(state, body, 0);
    expect(rb.setGravityScale).toHaveBeenCalledWith(0, true);
  });

  it('getGravityFactor should return rb.gravityScale()', () => {
    expect(getGravityFactor(state, body)).toBe(1.5);
  });

  it('getGravityFactor should return 1 when no rigid body exists', () => {
    expect(getGravityFactor(state, makeMockBody('x'))).toBe(1);
  });
});

describe('setTargetTransform', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('kin');
    state.bodyToRigidBody.set(body, rb);
  });

  it('should set next kinematic translation and rotation', () => {
    setTargetTransform(state, body, makeBjsVector3(10, 20, 30), makeBjsQuaternion(0, 0.7, 0, 0.7));

    expect(rb.setNextKinematicTranslation).toHaveBeenCalled();
    const posArg = rb.setNextKinematicTranslation.mock.calls[0][0];
    expect(posArg.x).toBe(10);
    expect(posArg.y).toBe(20);
    expect(posArg.z).toBe(30);

    expect(rb.setNextKinematicRotation).toHaveBeenCalled();
    const rotArg = rb.setNextKinematicRotation.mock.calls[0][0];
    expect(rotArg.y).toBeCloseTo(0.7);
    expect(rotArg.w).toBeCloseTo(0.7);
  });

  it('should be a no-op when no rigid body exists', () => {
    setTargetTransform(state, makeMockBody('x'), makeBjsVector3(), makeBjsQuaternion());
    expect(rb.setNextKinematicTranslation).not.toHaveBeenCalled();
  });
});

describe('setPhysicsBodyTransformation', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody();
    body = makeMockBody('prestep');
    state.bodyToRigidBody.set(body, rb);
  });

  it('should teleport (default) when getPrestepType returns TELEPORT (1)', () => {
    body.getPrestepType = vi.fn(() => 1);
    body.transformNode.absolutePosition = makeBjsVector3(10, 20, 30);
    body.transformNode.absoluteRotationQuaternion = makeBjsQuaternion(0, 0.7, 0, 0.7);

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setTranslation).toHaveBeenCalled();
    const posArg = rb.setTranslation.mock.calls[0][0];
    expect(posArg.x).toBe(10);
    expect(posArg.y).toBe(20);
    expect(posArg.z).toBe(30);

    expect(rb.setRotation).toHaveBeenCalled();
    const rotArg = rb.setRotation.mock.calls[0][0];
    expect(rotArg.y).toBeCloseTo(0.7);
    expect(rotArg.w).toBeCloseTo(0.7);
  });

  it('should use setTargetTransform when getPrestepType returns ACTION (2)', () => {
    body.getPrestepType = vi.fn(() => 2);
    body.transformNode.absolutePosition = makeBjsVector3(5, 6, 7);
    body.transformNode.absoluteRotationQuaternion = makeBjsQuaternion(0, 0, 0, 1);

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setNextKinematicTranslation).toHaveBeenCalled();
    expect(rb.setNextKinematicRotation).toHaveBeenCalled();
    // Should NOT use direct setTranslation
    expect(rb.setTranslation).not.toHaveBeenCalled();
  });

  it('should be a no-op when getPrestepType returns DISABLED (0)', () => {
    body.getPrestepType = vi.fn(() => 0);

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setTranslation).not.toHaveBeenCalled();
    expect(rb.setRotation).not.toHaveBeenCalled();
    expect(rb.setNextKinematicTranslation).not.toHaveBeenCalled();
  });

  it('should be a no-op when node is null', () => {
    body.getPrestepType = vi.fn(() => 1);

    setPhysicsBodyTransformation(state, body, null as any);

    expect(rb.setTranslation).not.toHaveBeenCalled();
  });

  it('should fall back to position when absolutePosition is not available', () => {
    body.getPrestepType = vi.fn(() => 1);
    body.transformNode.position = makeBjsVector3(1, 2, 3);
    // No absolutePosition set

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setTranslation).toHaveBeenCalled();
    const posArg = rb.setTranslation.mock.calls[0][0];
    expect(posArg.x).toBe(1);
    expect(posArg.y).toBe(2);
    expect(posArg.z).toBe(3);
  });

  it('should default to TELEPORT when getPrestepType is not defined', () => {
    // No getPrestepType method on body
    body.transformNode.absolutePosition = makeBjsVector3(4, 5, 6);
    body.transformNode.absoluteRotationQuaternion = makeBjsQuaternion(0, 0, 0, 1);

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setTranslation).toHaveBeenCalled();
    expect(rb.setRotation).toHaveBeenCalled();
  });

  it('should skip rotation when no rotation quaternion is available', () => {
    body.getPrestepType = vi.fn(() => 1);
    body.transformNode.absolutePosition = makeBjsVector3(1, 2, 3);
    // rotationQuaternion is null and no absoluteRotationQuaternion

    setPhysicsBodyTransformation(state, body, body.transformNode);

    expect(rb.setTranslation).toHaveBeenCalled();
    expect(rb.setRotation).not.toHaveBeenCalled();
  });
});

describe('setActivationControl', () => {
  let state: RapierPluginState;
  let rb: any;
  let body: any;

  beforeEach(() => {
    state = makeState();
    rb = makeMockRigidBody({
      wakeUp: vi.fn(),
      sleep: vi.fn(),
    });
    body = makeMockBody('activation');
    state.bodyToRigidBody.set(body, rb);
  });

  it('should wake up body for SIMULATION_CONTROLLED (0)', () => {
    setActivationControl(state, body, 0);
    expect(rb.wakeUp).toHaveBeenCalled();
    expect(rb.sleep).not.toHaveBeenCalled();
  });

  it('should wake up body for ALWAYS_ACTIVE (1)', () => {
    setActivationControl(state, body, 1);
    expect(rb.wakeUp).toHaveBeenCalled();
    expect(rb.sleep).not.toHaveBeenCalled();
  });

  it('should sleep body for ALWAYS_INACTIVE (2)', () => {
    setActivationControl(state, body, 2);
    expect(rb.sleep).toHaveBeenCalled();
    expect(rb.wakeUp).not.toHaveBeenCalled();
  });

  it('should be a no-op when no rigid body exists', () => {
    setActivationControl(state, makeMockBody('x'), 0);
    expect(rb.wakeUp).not.toHaveBeenCalled();
  });
});
