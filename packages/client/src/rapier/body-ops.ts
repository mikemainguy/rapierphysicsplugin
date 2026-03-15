import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, PhysicsMotionType } from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsMassProperties,
  TransformNode,
  Mesh,
} from '@babylonjs/core';
import type { RapierPluginState } from './types.js';

function createBodyDesc(state: RapierPluginState, motionType: PhysicsMotionType): RAPIER.RigidBodyDesc {
  switch (motionType) {
    case PhysicsMotionType.DYNAMIC:
      return state.rapier.RigidBodyDesc.dynamic();
    case PhysicsMotionType.STATIC:
      return state.rapier.RigidBodyDesc.fixed();
    case PhysicsMotionType.ANIMATED:
      return state.rapier.RigidBodyDesc.kinematicPositionBased();
    default:
      return state.rapier.RigidBodyDesc.dynamic();
  }
}

/** Returns the instance RigidBody at index (defaulting to 0), or the single body if no instances. */
export function getInstanceRigidBody(
  state: RapierPluginState,
  body: PhysicsBody,
  instanceIndex?: number,
): RAPIER.RigidBody | undefined {
  const instances = state.bodyToInstanceRigidBodies.get(body);
  if (instances) {
    return instances[instanceIndex ?? 0];
  }
  return state.bodyToRigidBody.get(body);
}

/** Applies fn to a specific instance, or all instances if instanceIndex is undefined. Falls back to single body. */
export function forEachRigidBody(
  state: RapierPluginState,
  body: PhysicsBody,
  instanceIndex: number | undefined,
  fn: (rb: RAPIER.RigidBody) => void,
): void {
  const instances = state.bodyToInstanceRigidBodies.get(body);
  if (instances) {
    if (instanceIndex !== undefined) {
      const rb = instances[instanceIndex];
      if (rb) fn(rb);
    } else {
      for (const rb of instances) fn(rb);
    }
    return;
  }
  const rb = state.bodyToRigidBody.get(body);
  if (rb) fn(rb);
}

export function initBody(
  state: RapierPluginState,
  body: PhysicsBody,
  motionType: PhysicsMotionType,
  position: Vector3,
  orientation: Quaternion,
): void {
  const bodyDesc = createBodyDesc(state, motionType);

  bodyDesc.setTranslation(position.x, position.y, position.z);
  bodyDesc.setRotation(new state.rapier.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

  const rigidBody = state.world.createRigidBody(bodyDesc);
  if (motionType === PhysicsMotionType.DYNAMIC) {
    rigidBody.enableCcd(true);
  }
  state.bodyToRigidBody.set(body, rigidBody);
  state.bodyToColliders.set(body, []);
}

export function initBodyInstances(
  state: RapierPluginState,
  body: PhysicsBody,
  motionType: PhysicsMotionType,
  mesh: Mesh,
): void {
  const storage = (mesh as any)._thinInstanceDataStorage;
  if (!storage) return;
  const count = storage.instancesCount ?? 0;
  const matrixData: Float32Array | undefined = storage.matrixData;
  if (!matrixData || count === 0) return;

  const rigidBodies: RAPIER.RigidBody[] = [];

  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    const px = matrixData[offset + 12];
    const py = matrixData[offset + 13];
    const pz = matrixData[offset + 14];

    const q = matrixToQuaternion(matrixData, offset);

    const bodyDesc = createBodyDesc(state, motionType);
    bodyDesc.setTranslation(px, py, pz);
    bodyDesc.setRotation(new state.rapier.Quaternion(q.x, q.y, q.z, q.w));

    const rb = state.world.createRigidBody(bodyDesc);
    if (motionType === PhysicsMotionType.DYNAMIC) {
      rb.enableCcd(true);
    }
    rigidBodies.push(rb);
  }

  state.bodyToInstanceRigidBodies.set(body, rigidBodies);
  state.bodyToInstanceColliders.set(body, rigidBodies.map(() => []));
  (body as any)._pluginDataInstances = { count };

  // Also store a dummy single body entry so shape-ops and other code that checks bodyToRigidBody can find the body
  if (!state.bodyToRigidBody.has(body) && rigidBodies.length > 0) {
    state.bodyToRigidBody.set(body, rigidBodies[0]);
  }
  if (!state.bodyToColliders.has(body)) {
    state.bodyToColliders.set(body, []);
  }
}

export function updateBodyInstances(
  state: RapierPluginState,
  body: PhysicsBody,
  mesh: Mesh,
): void {
  const instances = state.bodyToInstanceRigidBodies.get(body);
  if (!instances) return;

  const storage = (mesh as any)._thinInstanceDataStorage;
  if (!storage) return;
  const newCount = storage.instancesCount ?? 0;
  const matrixData: Float32Array | undefined = storage.matrixData;
  if (!matrixData) return;

  const oldCount = instances.length;
  const instanceColliders = state.bodyToInstanceColliders.get(body) ?? [];

  // Remove excess instances
  if (newCount < oldCount) {
    for (let i = newCount; i < oldCount; i++) {
      const cols = instanceColliders[i] ?? [];
      for (const col of cols) {
        state.colliderHandleToBody.delete(col.handle);
      }
      state.world.removeRigidBody(instances[i]);
    }
    instances.length = newCount;
    instanceColliders.length = newCount;
  }

  // Add new instances
  if (newCount > oldCount) {
    const pluginData = (body as any)._pluginDataInstances;
    const motionType = pluginData?._motionType ?? PhysicsMotionType.DYNAMIC;

    // Clone colliders from instance 0 if available
    const templateColliders = instanceColliders[0] ?? [];

    for (let i = oldCount; i < newCount; i++) {
      const offset = i * 16;
      const px = matrixData[offset + 12];
      const py = matrixData[offset + 13];
      const pz = matrixData[offset + 14];
      const q = matrixToQuaternion(matrixData, offset);

      const bodyDesc = createBodyDesc(state, motionType);
      bodyDesc.setTranslation(px, py, pz);
      bodyDesc.setRotation(new state.rapier.Quaternion(q.x, q.y, q.z, q.w));

      const rb = state.world.createRigidBody(bodyDesc);
      if (motionType === PhysicsMotionType.DYNAMIC) {
        rb.enableCcd(true);
      }
      instances.push(rb);

      // Clone colliders from template
      const newCols: RAPIER.Collider[] = [];
      for (const templateCol of templateColliders) {
        const shape = templateCol.shape;
        const desc = rebuildColliderDesc(state, shape);
        if (desc) {
          const col = state.world.createCollider(desc, rb);
          state.colliderHandleToBody.set(col.handle, body);
          newCols.push(col);
        }
      }
      instanceColliders.push(newCols);
    }
  }

  // Update transforms of remaining instances
  const count = Math.min(newCount, oldCount);
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    const px = matrixData[offset + 12];
    const py = matrixData[offset + 13];
    const pz = matrixData[offset + 14];
    const q = matrixToQuaternion(matrixData, offset);

    const rb = instances[i];
    rb.setTranslation(new state.rapier.Vector3(px, py, pz), true);
    rb.setRotation(new state.rapier.Quaternion(q.x, q.y, q.z, q.w), true);
  }

  if ((body as any)._pluginDataInstances) {
    (body as any)._pluginDataInstances.count = newCount;
  }
}

function rebuildColliderDesc(state: RapierPluginState, shape: RAPIER.Shape): RAPIER.ColliderDesc | null {
  const shapeType = shape.type;
  const RAPIER = state.rapier;

  switch (shapeType) {
    case RAPIER.ShapeType.Ball:
      return RAPIER.ColliderDesc.ball((shape as any).radius);
    case RAPIER.ShapeType.Cuboid: {
      const he = (shape as any).halfExtents;
      return RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
    }
    case RAPIER.ShapeType.Capsule:
      return RAPIER.ColliderDesc.capsule((shape as any).halfHeight, (shape as any).radius);
    case RAPIER.ShapeType.Cylinder:
      return RAPIER.ColliderDesc.cylinder((shape as any).halfHeight, (shape as any).radius);
    default:
      return null;
  }
}

export function disposeBody(state: RapierPluginState, body: PhysicsBody): void {
  // Clean up instances first
  const instances = state.bodyToInstanceRigidBodies.get(body);
  if (instances) {
    const instanceColliders = state.bodyToInstanceColliders.get(body) ?? [];
    for (const cols of instanceColliders) {
      for (const col of cols) {
        state.colliderHandleToBody.delete(col.handle);
      }
    }
    for (const rb of instances) {
      state.world.removeRigidBody(rb);
    }
    state.bodyToInstanceRigidBodies.delete(body);
    state.bodyToInstanceColliders.delete(body);
    (body as any)._pluginDataInstances = undefined;
  }

  const rb = state.bodyToRigidBody.get(body);
  if (rb) {
    // Don't remove the rb again if it was instance 0 and already removed above
    if (!instances) {
      state.world.removeRigidBody(rb);
    }

    const colliders = state.bodyToColliders.get(body) ?? [];
    for (const col of colliders) {
      state.colliderHandleToBody.delete(col.handle);
    }

    state.bodyToRigidBody.delete(body);
    state.bodyToColliders.delete(body);
    state.bodyCollisionObservables.delete(body);
    state.bodyCollisionEndedObservables.delete(body);
    state.collisionCallbackEnabled.delete(body);
    state.collisionEndedCallbackEnabled.delete(body);

    const shape = state.bodyToShape.get(body);
    if (shape) {
      state.shapeToBody.delete(shape);
    }
    state.bodyToShape.delete(body);
    state.bodyEventMask.delete(body);
  }
}

export function syncBody(state: RapierPluginState, body: PhysicsBody): void {
  const instances = state.bodyToInstanceRigidBodies.get(body);
  if (instances) {
    syncBodyInstances(state, body, instances);
    return;
  }

  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;
  const tn = body.transformNode;
  if (!tn) return;

  const pos = rb.translation();
  const rot = rb.rotation();
  tn.position.set(pos.x, pos.y, pos.z);
  tn.rotationQuaternion = tn.rotationQuaternion ?? new Quaternion();
  tn.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
}

function syncBodyInstances(state: RapierPluginState, body: PhysicsBody, instances: RAPIER.RigidBody[]): void {
  const tn = body.transformNode;
  if (!tn) return;
  const mesh = tn as Mesh;
  const storage = (mesh as any)._thinInstanceDataStorage;
  if (!storage?.matrixData) return;

  const matrixData: Float32Array = storage.matrixData;

  for (let i = 0; i < instances.length; i++) {
    const rb = instances[i];
    const pos = rb.translation();
    const rot = rb.rotation();
    const offset = i * 16;

    quaternionToMatrix(rot.x, rot.y, rot.z, rot.w, matrixData, offset);
    matrixData[offset + 12] = pos.x;
    matrixData[offset + 13] = pos.y;
    matrixData[offset + 14] = pos.z;
    matrixData[offset + 15] = 1;
  }

  if (typeof mesh.thinInstanceBufferUpdated === 'function') {
    mesh.thinInstanceBufferUpdated('matrix');
  }
}

function quaternionToMatrix(x: number, y: number, z: number, w: number, out: Float32Array, offset: number): void {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  out[offset + 0] = 1 - (yy + zz);
  out[offset + 1] = xy + wz;
  out[offset + 2] = xz - wy;
  out[offset + 3] = 0;
  out[offset + 4] = xy - wz;
  out[offset + 5] = 1 - (xx + zz);
  out[offset + 6] = yz + wx;
  out[offset + 7] = 0;
  out[offset + 8] = xz + wy;
  out[offset + 9] = yz - wx;
  out[offset + 10] = 1 - (xx + yy);
  out[offset + 11] = 0;
}

function matrixToQuaternion(m: Float32Array, offset: number): { x: number; y: number; z: number; w: number } {
  const m00 = m[offset], m01 = m[offset + 1], m02 = m[offset + 2];
  const m10 = m[offset + 4], m11 = m[offset + 5], m12 = m[offset + 6];
  const m20 = m[offset + 8], m21 = m[offset + 9], m22 = m[offset + 10];

  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m12 - m21) * s;
    y = (m20 - m02) * s;
    z = (m01 - m10) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m12 - m21) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m20 - m02) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m01 - m10) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return { x, y, z, w };
}

export function syncTransform(state: RapierPluginState, body: PhysicsBody, transformNode: TransformNode): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  const pos = rb.translation();
  const rot = rb.rotation();
  transformNode.position.set(pos.x, pos.y, pos.z);
  transformNode.rotationQuaternion = transformNode.rotationQuaternion ?? new Quaternion();
  transformNode.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
}

export function setMotionType(state: RapierPluginState, body: PhysicsBody, motionType: PhysicsMotionType, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    switch (motionType) {
      case PhysicsMotionType.DYNAMIC:
        rb.setBodyType(state.rapier.RigidBodyType.Dynamic, true);
        break;
      case PhysicsMotionType.STATIC:
        rb.setBodyType(state.rapier.RigidBodyType.Fixed, true);
        break;
      case PhysicsMotionType.ANIMATED:
        rb.setBodyType(state.rapier.RigidBodyType.KinematicPositionBased, true);
        break;
    }
  });
}

export function getMotionType(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): PhysicsMotionType {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  if (!rb) return PhysicsMotionType.STATIC;

  if (rb.isDynamic()) return PhysicsMotionType.DYNAMIC;
  if (rb.isKinematic()) return PhysicsMotionType.ANIMATED;
  return PhysicsMotionType.STATIC;
}

export function computeMassProperties(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): PhysicsMassProperties {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  if (!rb) return { mass: 1, centerOfMass: Vector3.Zero(), inertia: Vector3.One(), inertiaOrientation: Quaternion.Identity() };
  const com = rb.localCom();
  const inertia = rb.principalInertia();
  const inertiaFrame = rb.principalInertiaLocalFrame();
  return {
    mass: rb.mass(),
    centerOfMass: new Vector3(com.x, com.y, com.z),
    inertia: new Vector3(inertia.x, inertia.y, inertia.z),
    inertiaOrientation: new Quaternion(inertiaFrame.x, inertiaFrame.y, inertiaFrame.z, inertiaFrame.w),
  };
}

export function setMassProperties(state: RapierPluginState, body: PhysicsBody, massProps: PhysicsMassProperties, instanceIndex?: number): void {
  const mass = massProps.mass ?? 0;
  const com = massProps.centerOfMass ?? Vector3.Zero();
  const inertia = massProps.inertia ?? Vector3.Zero();
  const inertiaOrientation = massProps.inertiaOrientation ?? Quaternion.Identity();

  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.setAdditionalMassProperties(
      mass,
      new state.rapier.Vector3(com.x, com.y, com.z),
      new state.rapier.Vector3(inertia.x, inertia.y, inertia.z),
      new state.rapier.Quaternion(inertiaOrientation.x, inertiaOrientation.y, inertiaOrientation.z, inertiaOrientation.w),
      true
    );
  });
}

export function getMassProperties(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): PhysicsMassProperties {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  if (!rb) return { mass: 1, centerOfMass: Vector3.Zero(), inertia: Vector3.One(), inertiaOrientation: Quaternion.Identity() };
  const com = rb.localCom();
  const inertia = rb.principalInertia();
  const inertiaFrame = rb.principalInertiaLocalFrame();
  return {
    mass: rb.mass(),
    centerOfMass: new Vector3(com.x, com.y, com.z),
    inertia: new Vector3(inertia.x, inertia.y, inertia.z),
    inertiaOrientation: new Quaternion(inertiaFrame.x, inertiaFrame.y, inertiaFrame.z, inertiaFrame.w),
  };
}

export function setLinearDamping(state: RapierPluginState, body: PhysicsBody, damping: number, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => rb.setLinearDamping(damping));
}

export function getLinearDamping(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): number {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  return rb?.linearDamping() ?? 0;
}

export function setAngularDamping(state: RapierPluginState, body: PhysicsBody, damping: number, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => rb.setAngularDamping(damping));
}

export function getAngularDamping(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): number {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  return rb?.angularDamping() ?? 0;
}

export function setLinearVelocity(state: RapierPluginState, body: PhysicsBody, linVel: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.setLinvel(new state.rapier.Vector3(linVel.x, linVel.y, linVel.z), true);
  });
}

export function getLinearVelocityToRef(state: RapierPluginState, body: PhysicsBody, linVel: Vector3, instanceIndex?: number): void {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  if (rb) {
    const v = rb.linvel();
    linVel.set(v.x, v.y, v.z);
  }
}

export function setAngularVelocity(state: RapierPluginState, body: PhysicsBody, angVel: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.setAngvel(new state.rapier.Vector3(angVel.x, angVel.y, angVel.z), true);
  });
}

export function getAngularVelocityToRef(state: RapierPluginState, body: PhysicsBody, angVel: Vector3, instanceIndex?: number): void {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  if (rb) {
    const v = rb.angvel();
    angVel.set(v.x, v.y, v.z);
  }
}

export function applyImpulse(state: RapierPluginState, body: PhysicsBody, impulse: Vector3, location: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.applyImpulseAtPoint(
      new state.rapier.Vector3(impulse.x, impulse.y, impulse.z),
      new state.rapier.Vector3(location.x, location.y, location.z),
      true
    );
  });
}

export function applyAngularImpulse(state: RapierPluginState, body: PhysicsBody, angularImpulse: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.applyTorqueImpulse(new state.rapier.Vector3(angularImpulse.x, angularImpulse.y, angularImpulse.z), true);
  });
}

export function applyForce(state: RapierPluginState, body: PhysicsBody, force: Vector3, location: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.addForceAtPoint(
      new state.rapier.Vector3(force.x, force.y, force.z),
      new state.rapier.Vector3(location.x, location.y, location.z),
      true
    );
  });
}

export function applyTorque(state: RapierPluginState, body: PhysicsBody, torque: Vector3, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.addTorque(new state.rapier.Vector3(torque.x, torque.y, torque.z), true);
  });
}

export function setGravityFactor(state: RapierPluginState, body: PhysicsBody, factor: number, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => rb.setGravityScale(factor, true));
}

export function getGravityFactor(state: RapierPluginState, body: PhysicsBody, instanceIndex?: number): number {
  const rb = getInstanceRigidBody(state, body, instanceIndex);
  return rb?.gravityScale() ?? 1;
}

export function setTargetTransform(state: RapierPluginState, body: PhysicsBody, position: Vector3, rotation: Quaternion, instanceIndex?: number): void {
  forEachRigidBody(state, body, instanceIndex, (rb) => {
    rb.setNextKinematicTranslation(new state.rapier.Vector3(position.x, position.y, position.z));
    rb.setNextKinematicRotation(new state.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
  });
}

// PhysicsPrestepType enum values from Babylon.js
const PRESTEP_DISABLED = 0;
const PRESTEP_TELEPORT = 1;
const PRESTEP_ACTION = 2;

export function setPhysicsBodyTransformation(
  state: RapierPluginState, body: PhysicsBody, node: TransformNode
): void {
  const prestepType = (body as any).getPrestepType?.();
  if (prestepType === PRESTEP_DISABLED) return;
  if (!node) return;

  const pos = (node as any).absolutePosition ?? node.position;
  const rot = (node as any).absoluteRotationQuaternion ?? (node as any).rotationQuaternion;

  if (prestepType === PRESTEP_ACTION) {
    if (rot) {
      setTargetTransform(state, body, pos, rot);
    }
    return;
  }

  // TELEPORT (1) or default
  forEachRigidBody(state, body, undefined, (rb) => {
    rb.setTranslation(new state.rapier.Vector3(pos.x, pos.y, pos.z), true);
    if (rot) {
      rb.setRotation(new state.rapier.Quaternion(rot.x, rot.y, rot.z, rot.w), true);
    }
  });
}

export function setActivationControl(
  state: RapierPluginState, body: PhysicsBody, controlMode: number
): void {
  forEachRigidBody(state, body, undefined, (rb) => {
    switch (controlMode) {
      case 0: // SIMULATION_CONTROLLED
        rb.wakeUp();
        break;
      case 1: // ALWAYS_ACTIVE
        rb.wakeUp();
        break;
      case 2: // ALWAYS_INACTIVE
        rb.sleep();
        break;
    }
  });
}
