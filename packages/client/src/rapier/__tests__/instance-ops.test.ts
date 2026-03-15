import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhysicsMotionType } from '@babylonjs/core';
import type { RapierPluginState } from '../types.js';
import {
  initBodyInstances,
  updateBodyInstances,
  syncBody,
  disposeBody,
  getInstanceRigidBody,
  forEachRigidBody,
  setLinearDamping,
  getLinearDamping,
  setGravityFactor,
  getGravityFactor,
  applyImpulse,
  setLinearVelocity,
  getLinearVelocityToRef,
} from '../body-ops.js';

// --- Mocks ---

class MockVector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

class MockQuaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

let handleCounter = 100;

function makeMockRigidBody(overrides: Record<string, any> = {}) {
  return {
    handle: handleCounter++,
    translation: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
    rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    linvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    angvel: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    mass: vi.fn(() => 1),
    localCom: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    principalInertia: vi.fn(() => ({ x: 1, y: 1, z: 1 })),
    principalInertiaLocalFrame: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    enableCcd: vi.fn(),
    setTranslation: vi.fn(),
    setRotation: vi.fn(),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
    setLinearDamping: vi.fn(),
    linearDamping: vi.fn(() => 0.5),
    setAngularDamping: vi.fn(),
    angularDamping: vi.fn(() => 0),
    setAdditionalMassProperties: vi.fn(),
    applyImpulseAtPoint: vi.fn(),
    applyTorqueImpulse: vi.fn(),
    addForceAtPoint: vi.fn(),
    addTorque: vi.fn(),
    setGravityScale: vi.fn(),
    gravityScale: vi.fn(() => 1),
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
  return { x, y, z, set: vi.fn(), clone: () => makeBjsVector3(x, y, z) } as any;
}

function makeMockBody(name: string) {
  return {
    transformNode: { name, position: makeBjsVector3(), rotationQuaternion: null as any },
    _pluginData: {},
    _pluginDataInstances: undefined as any,
    shape: null,
  } as any;
}

function makeIdentityMatrix(px: number, py: number, pz: number): Float32Array {
  // Column-major 4x4 identity with translation
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    px, py, pz, 1,
  ]);
}

function makeMatrixDataForInstances(positions: Array<[number, number, number]>): Float32Array {
  const data = new Float32Array(positions.length * 16);
  for (let i = 0; i < positions.length; i++) {
    const m = makeIdentityMatrix(positions[i][0], positions[i][1], positions[i][2]);
    data.set(m, i * 16);
  }
  return data;
}

function makeMockMesh(positions: Array<[number, number, number]>) {
  const matrixData = makeMatrixDataForInstances(positions);
  return {
    _thinInstanceDataStorage: {
      instancesCount: positions.length,
      matrixData,
    },
    thinInstanceBufferUpdated: vi.fn(),
  } as any;
}

function makeState(overrides: Partial<RapierPluginState> = {}): RapierPluginState {
  return {
    rapier: {
      RigidBodyDesc: {
        dynamic: vi.fn(() => ({ setTranslation: vi.fn(), setRotation: vi.fn() })),
        fixed: vi.fn(() => ({ setTranslation: vi.fn(), setRotation: vi.fn() })),
        kinematicPositionBased: vi.fn(() => ({ setTranslation: vi.fn(), setRotation: vi.fn() })),
      },
      RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 },
      Vector3: MockVector3,
      Quaternion: MockQuaternion,
    } as any,
    world: {
      createRigidBody: vi.fn(() => makeMockRigidBody()),
      removeRigidBody: vi.fn(),
      createCollider: vi.fn(),
      removeCollider: vi.fn(),
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

// --- Tests ---

describe('initBodyInstances', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    handleCounter = 100;
    state = makeState();
  });

  it('creates N RigidBodies from matrix data', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0], [5, 0, 0], [10, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);

    const instances = state.bodyToInstanceRigidBodies.get(body)!;
    expect(instances).toBeDefined();
    expect(instances.length).toBe(3);
    expect(state.world.createRigidBody).toHaveBeenCalledTimes(3);
  });

  it('sets translation from matrix data for each instance', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[1, 2, 3], [4, 5, 6]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);

    const desc1 = (state.rapier.RigidBodyDesc.dynamic as any).mock.results[0].value;
    expect(desc1.setTranslation).toHaveBeenCalledWith(1, 2, 3);

    const desc2 = (state.rapier.RigidBodyDesc.dynamic as any).mock.results[1].value;
    expect(desc2.setTranslation).toHaveBeenCalledWith(4, 5, 6);
  });

  it('enables CCD for dynamic instances', () => {
    const rb = makeMockRigidBody();
    state.world.createRigidBody = vi.fn(() => rb);

    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);
    expect(rb.enableCcd).toHaveBeenCalledWith(true);
  });

  it('does not enable CCD for static instances', () => {
    const rb = makeMockRigidBody();
    state.world.createRigidBody = vi.fn(() => rb);

    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.STATIC, mesh);
    expect(rb.enableCcd).not.toHaveBeenCalled();
  });

  it('sets _pluginDataInstances on the body', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0], [1, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);
    expect(body._pluginDataInstances).toEqual({ count: 2 });
  });

  it('initializes bodyToInstanceColliders with empty arrays', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0], [1, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);
    const cols = state.bodyToInstanceColliders.get(body)!;
    expect(cols).toBeDefined();
    expect(cols.length).toBe(2);
    expect(cols[0]).toEqual([]);
    expect(cols[1]).toEqual([]);
  });

  it('is a no-op when mesh has no thin instance storage', () => {
    const body = makeMockBody('inst');
    const mesh = {} as any;

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);
    expect(state.bodyToInstanceRigidBodies.has(body)).toBe(false);
  });

  it('also sets bodyToRigidBody to instance 0 for compatibility', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0]]);

    initBodyInstances(state, body, PhysicsMotionType.DYNAMIC, mesh);

    const instances = state.bodyToInstanceRigidBodies.get(body)!;
    expect(state.bodyToRigidBody.get(body)).toBe(instances[0]);
  });
});

describe('getInstanceRigidBody', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('returns instance at specified index when instances exist', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    expect(getInstanceRigidBody(state, body, 0)).toBe(rb0);
    expect(getInstanceRigidBody(state, body, 1)).toBe(rb1);
  });

  it('returns instance 0 when instanceIndex is undefined and instances exist', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0]);

    expect(getInstanceRigidBody(state, body)).toBe(rb0);
  });

  it('returns single body when no instances exist', () => {
    const body = makeMockBody('single');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    expect(getInstanceRigidBody(state, body)).toBe(rb);
    expect(getInstanceRigidBody(state, body, 0)).toBe(rb);
  });

  it('returns undefined when nothing is mapped', () => {
    const body = makeMockBody('missing');
    expect(getInstanceRigidBody(state, body)).toBeUndefined();
  });
});

describe('forEachRigidBody', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('applies fn to all instances when instanceIndex is undefined', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    const rb2 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1, rb2]);

    const visited: any[] = [];
    forEachRigidBody(state, body, undefined, (rb) => visited.push(rb));

    expect(visited).toEqual([rb0, rb1, rb2]);
  });

  it('applies fn to only specified instance when index given', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    const visited: any[] = [];
    forEachRigidBody(state, body, 1, (rb) => visited.push(rb));

    expect(visited).toEqual([rb1]);
  });

  it('falls back to single body when no instances', () => {
    const body = makeMockBody('single');
    const rb = makeMockRigidBody();
    state.bodyToRigidBody.set(body, rb);

    const visited: any[] = [];
    forEachRigidBody(state, body, undefined, (r) => visited.push(r));

    expect(visited).toEqual([rb]);
  });
});

describe('setter with instanceIndex', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('setLinearDamping with undefined applies to all instances', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    setLinearDamping(state, body, 0.3);

    expect(rb0.setLinearDamping).toHaveBeenCalledWith(0.3);
    expect(rb1.setLinearDamping).toHaveBeenCalledWith(0.3);
  });

  it('setLinearDamping with specific index targets one', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    setLinearDamping(state, body, 0.7, 1);

    expect(rb0.setLinearDamping).not.toHaveBeenCalled();
    expect(rb1.setLinearDamping).toHaveBeenCalledWith(0.7);
  });

  it('setGravityFactor with undefined applies to all instances', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    setGravityFactor(state, body, 0);

    expect(rb0.setGravityScale).toHaveBeenCalledWith(0, true);
    expect(rb1.setGravityScale).toHaveBeenCalledWith(0, true);
  });

  it('applyImpulse with specific index targets one instance', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    applyImpulse(state, body, makeBjsVector3(1, 0, 0), makeBjsVector3(0, 0, 0), 0);

    expect(rb0.applyImpulseAtPoint).toHaveBeenCalled();
    expect(rb1.applyImpulseAtPoint).not.toHaveBeenCalled();
  });

  it('setLinearVelocity with undefined applies to all instances', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    setLinearVelocity(state, body, makeBjsVector3(1, 2, 3));

    expect(rb0.setLinvel).toHaveBeenCalled();
    expect(rb1.setLinvel).toHaveBeenCalled();
  });
});

describe('getter with instanceIndex', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('getLinearDamping with undefined returns instance 0', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody({ linearDamping: vi.fn(() => 0.3) });
    const rb1 = makeMockRigidBody({ linearDamping: vi.fn(() => 0.7) });
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    expect(getLinearDamping(state, body)).toBe(0.3);
  });

  it('getLinearDamping with specific index returns that instance', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody({ linearDamping: vi.fn(() => 0.3) });
    const rb1 = makeMockRigidBody({ linearDamping: vi.fn(() => 0.7) });
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    expect(getLinearDamping(state, body, 1)).toBe(0.7);
  });

  it('getGravityFactor with undefined returns instance 0', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody({ gravityScale: vi.fn(() => 2) });
    state.bodyToInstanceRigidBodies.set(body, [rb0]);

    expect(getGravityFactor(state, body)).toBe(2);
  });

  it('getLinearVelocityToRef reads from specified instance', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody({ linvel: vi.fn(() => ({ x: 1, y: 2, z: 3 })) });
    const rb1 = makeMockRigidBody({ linvel: vi.fn(() => ({ x: 4, y: 5, z: 6 })) });
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    const ref = makeBjsVector3();
    getLinearVelocityToRef(state, body, ref, 1);
    expect(ref.set).toHaveBeenCalledWith(4, 5, 6);
  });
});

describe('syncBody with instances', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('writes transforms back to matrixData', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0], [5, 0, 0]]);
    body.transformNode = mesh;

    const rb0 = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
      rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    });
    const rb1 = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 10, y: 20, z: 30 })),
      rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    });

    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);

    syncBody(state, body);

    const matrixData = mesh._thinInstanceDataStorage.matrixData;
    // Instance 0: position at [12,13,14]
    expect(matrixData[12]).toBe(1);
    expect(matrixData[13]).toBe(2);
    expect(matrixData[14]).toBe(3);

    // Instance 1: position at [16+12, 16+13, 16+14]
    expect(matrixData[28]).toBe(10);
    expect(matrixData[29]).toBe(20);
    expect(matrixData[30]).toBe(30);
  });

  it('calls thinInstanceBufferUpdated after writing', () => {
    const body = makeMockBody('inst');
    const mesh = makeMockMesh([[0, 0, 0]]);
    body.transformNode = mesh;

    const rb0 = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      rotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    });
    state.bodyToInstanceRigidBodies.set(body, [rb0]);

    syncBody(state, body);

    expect(mesh.thinInstanceBufferUpdated).toHaveBeenCalledWith('matrix');
  });

  it('does not affect single-body sync behavior', () => {
    const body = makeMockBody('single');
    const rb = makeMockRigidBody({
      translation: vi.fn(() => ({ x: 10, y: 20, z: 30 })),
      rotation: vi.fn(() => ({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 })),
    });
    state.bodyToRigidBody.set(body, rb);

    syncBody(state, body);

    expect(body.transformNode.position.set).toHaveBeenCalledWith(10, 20, 30);
  });
});

describe('disposeBody with instances', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    state = makeState();
  });

  it('cleans up all instance RigidBodies', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    const rb2 = makeMockRigidBody();

    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1, rb2]);
    state.bodyToInstanceColliders.set(body, [[], [], []]);
    state.bodyToRigidBody.set(body, rb0);
    state.bodyToColliders.set(body, []);

    disposeBody(state, body);

    expect(state.world.removeRigidBody).toHaveBeenCalledTimes(3);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb0);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb1);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb2);
    expect(state.bodyToInstanceRigidBodies.has(body)).toBe(false);
    expect(state.bodyToInstanceColliders.has(body)).toBe(false);
  });

  it('cleans up instance collider handle mappings', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const col0 = { handle: 50 } as any;
    const col1 = { handle: 51 } as any;

    state.bodyToInstanceRigidBodies.set(body, [rb0]);
    state.bodyToInstanceColliders.set(body, [[col0, col1]]);
    state.colliderHandleToBody.set(50, body);
    state.colliderHandleToBody.set(51, body);
    state.bodyToRigidBody.set(body, rb0);
    state.bodyToColliders.set(body, []);

    disposeBody(state, body);

    expect(state.colliderHandleToBody.has(50)).toBe(false);
    expect(state.colliderHandleToBody.has(51)).toBe(false);
  });

  it('clears _pluginDataInstances on body', () => {
    const body = makeMockBody('inst');
    body._pluginDataInstances = { count: 2 };
    const rb0 = makeMockRigidBody();

    state.bodyToInstanceRigidBodies.set(body, [rb0]);
    state.bodyToInstanceColliders.set(body, [[]]);
    state.bodyToRigidBody.set(body, rb0);
    state.bodyToColliders.set(body, []);

    disposeBody(state, body);

    expect(body._pluginDataInstances).toBeUndefined();
  });

  it('single-body dispose is completely unchanged', () => {
    const body = makeMockBody('single');
    const rb = makeMockRigidBody();
    const col = { handle: 99 } as any;

    state.bodyToRigidBody.set(body, rb);
    state.bodyToColliders.set(body, [col]);
    state.colliderHandleToBody.set(99, body);

    disposeBody(state, body);

    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb);
    expect(state.bodyToRigidBody.has(body)).toBe(false);
    expect(state.colliderHandleToBody.has(99)).toBe(false);
  });
});

describe('updateBodyInstances', () => {
  let state: RapierPluginState;

  beforeEach(() => {
    handleCounter = 100;
    state = makeState();
  });

  it('adds new instances when count increases', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0]);
    state.bodyToInstanceColliders.set(body, [[]]);

    const mesh = makeMockMesh([[0, 0, 0], [5, 0, 0], [10, 0, 0]]);

    updateBodyInstances(state, body, mesh);

    const instances = state.bodyToInstanceRigidBodies.get(body)!;
    expect(instances.length).toBe(3);
    // Original rb0 + 2 new ones
    expect(state.world.createRigidBody).toHaveBeenCalledTimes(2);
  });

  it('removes excess instances when count decreases', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    const rb2 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1, rb2]);
    state.bodyToInstanceColliders.set(body, [[], [], []]);

    const mesh = makeMockMesh([[0, 0, 0]]);

    updateBodyInstances(state, body, mesh);

    const instances = state.bodyToInstanceRigidBodies.get(body)!;
    expect(instances.length).toBe(1);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb1);
    expect(state.world.removeRigidBody).toHaveBeenCalledWith(rb2);
  });

  it('updates transforms of existing instances', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    state.bodyToInstanceRigidBodies.set(body, [rb0]);
    state.bodyToInstanceColliders.set(body, [[]]);

    const mesh = makeMockMesh([[99, 88, 77]]);

    updateBodyInstances(state, body, mesh);

    expect(rb0.setTranslation).toHaveBeenCalled();
    const posArg = rb0.setTranslation.mock.calls[0][0];
    expect(posArg.x).toBe(99);
    expect(posArg.y).toBe(88);
    expect(posArg.z).toBe(77);
  });

  it('is a no-op when body has no instances', () => {
    const body = makeMockBody('single');
    const mesh = makeMockMesh([[0, 0, 0]]);

    updateBodyInstances(state, body, mesh);

    expect(state.world.createRigidBody).not.toHaveBeenCalled();
  });

  it('removes collider handle mappings for deleted instances', () => {
    const body = makeMockBody('inst');
    const rb0 = makeMockRigidBody();
    const rb1 = makeMockRigidBody();
    const col1 = { handle: 42 } as any;

    state.bodyToInstanceRigidBodies.set(body, [rb0, rb1]);
    state.bodyToInstanceColliders.set(body, [[], [col1]]);
    state.colliderHandleToBody.set(42, body);

    const mesh = makeMockMesh([[0, 0, 0]]);

    updateBodyInstances(state, body, mesh);

    expect(state.colliderHandleToBody.has(42)).toBe(false);
  });
});
