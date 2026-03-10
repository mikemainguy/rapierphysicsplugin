import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, PhysicsMotionType } from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsMassProperties,
  TransformNode,
} from '@babylonjs/core';
import type { RapierPluginState } from './rapier-types.js';

export function initBody(
  state: RapierPluginState,
  body: PhysicsBody,
  motionType: PhysicsMotionType,
  position: Vector3,
  orientation: Quaternion,
): void {
  let bodyDesc: RAPIER.RigidBodyDesc;
  switch (motionType) {
    case PhysicsMotionType.DYNAMIC:
      bodyDesc = state.rapier.RigidBodyDesc.dynamic();
      break;
    case PhysicsMotionType.STATIC:
      bodyDesc = state.rapier.RigidBodyDesc.fixed();
      break;
    case PhysicsMotionType.ANIMATED:
      bodyDesc = state.rapier.RigidBodyDesc.kinematicPositionBased();
      break;
    default:
      bodyDesc = state.rapier.RigidBodyDesc.dynamic();
  }

  bodyDesc.setTranslation(position.x, position.y, position.z);
  bodyDesc.setRotation(new state.rapier.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

  const rigidBody = state.world.createRigidBody(bodyDesc);
  if (motionType === PhysicsMotionType.DYNAMIC) {
    rigidBody.enableCcd(true);
  }
  state.bodyToRigidBody.set(body, rigidBody);
  state.bodyToColliders.set(body, []);
}

export function disposeBody(state: RapierPluginState, body: PhysicsBody): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) {
    const colliders = state.bodyToColliders.get(body) ?? [];
    for (const col of colliders) {
      state.colliderHandleToBody.delete(col.handle);
    }

    state.world.removeRigidBody(rb);
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

export function syncTransform(state: RapierPluginState, body: PhysicsBody, transformNode: TransformNode): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  const pos = rb.translation();
  const rot = rb.rotation();
  transformNode.position.set(pos.x, pos.y, pos.z);
  transformNode.rotationQuaternion = transformNode.rotationQuaternion ?? new Quaternion();
  transformNode.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w);
}

export function setMotionType(state: RapierPluginState, body: PhysicsBody, motionType: PhysicsMotionType): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

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
}

export function getMotionType(state: RapierPluginState, body: PhysicsBody): PhysicsMotionType {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return PhysicsMotionType.STATIC;

  if (rb.isDynamic()) return PhysicsMotionType.DYNAMIC;
  if (rb.isKinematic()) return PhysicsMotionType.ANIMATED;
  return PhysicsMotionType.STATIC;
}

export function computeMassProperties(state: RapierPluginState, body: PhysicsBody): PhysicsMassProperties {
  const rb = state.bodyToRigidBody.get(body);
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

export function setMassProperties(state: RapierPluginState, body: PhysicsBody, massProps: PhysicsMassProperties): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  const mass = massProps.mass ?? 0;
  const com = massProps.centerOfMass ?? Vector3.Zero();
  const inertia = massProps.inertia ?? Vector3.Zero();
  const inertiaOrientation = massProps.inertiaOrientation ?? Quaternion.Identity();

  rb.setAdditionalMassProperties(
    mass,
    new state.rapier.Vector3(com.x, com.y, com.z),
    new state.rapier.Vector3(inertia.x, inertia.y, inertia.z),
    new state.rapier.Quaternion(inertiaOrientation.x, inertiaOrientation.y, inertiaOrientation.z, inertiaOrientation.w),
    true
  );
}

export function getMassProperties(state: RapierPluginState, body: PhysicsBody): PhysicsMassProperties {
  const rb = state.bodyToRigidBody.get(body);
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

export function setLinearDamping(state: RapierPluginState, body: PhysicsBody, damping: number): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) rb.setLinearDamping(damping);
}

export function getLinearDamping(state: RapierPluginState, body: PhysicsBody): number {
  const rb = state.bodyToRigidBody.get(body);
  return rb?.linearDamping() ?? 0;
}

export function setAngularDamping(state: RapierPluginState, body: PhysicsBody, damping: number): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) rb.setAngularDamping(damping);
}

export function getAngularDamping(state: RapierPluginState, body: PhysicsBody): number {
  const rb = state.bodyToRigidBody.get(body);
  return rb?.angularDamping() ?? 0;
}

export function setLinearVelocity(state: RapierPluginState, body: PhysicsBody, linVel: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) rb.setLinvel(new state.rapier.Vector3(linVel.x, linVel.y, linVel.z), true);
}

export function getLinearVelocityToRef(state: RapierPluginState, body: PhysicsBody, linVel: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) {
    const v = rb.linvel();
    linVel.set(v.x, v.y, v.z);
  }
}

export function setAngularVelocity(state: RapierPluginState, body: PhysicsBody, angVel: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) rb.setAngvel(new state.rapier.Vector3(angVel.x, angVel.y, angVel.z), true);
}

export function getAngularVelocityToRef(state: RapierPluginState, body: PhysicsBody, angVel: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) {
    const v = rb.angvel();
    angVel.set(v.x, v.y, v.z);
  }
}

export function applyImpulse(state: RapierPluginState, body: PhysicsBody, impulse: Vector3, location: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  rb.applyImpulseAtPoint(
    new state.rapier.Vector3(impulse.x, impulse.y, impulse.z),
    new state.rapier.Vector3(location.x, location.y, location.z),
    true
  );
}

export function applyAngularImpulse(state: RapierPluginState, body: PhysicsBody, angularImpulse: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;
  rb.applyTorqueImpulse(new state.rapier.Vector3(angularImpulse.x, angularImpulse.y, angularImpulse.z), true);
}

export function applyForce(state: RapierPluginState, body: PhysicsBody, force: Vector3, location: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  rb.addForceAtPoint(
    new state.rapier.Vector3(force.x, force.y, force.z),
    new state.rapier.Vector3(location.x, location.y, location.z),
    true
  );
}

export function applyTorque(state: RapierPluginState, body: PhysicsBody, torque: Vector3): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;
  rb.addTorque(new state.rapier.Vector3(torque.x, torque.y, torque.z), true);
}

export function setGravityFactor(state: RapierPluginState, body: PhysicsBody, factor: number): void {
  const rb = state.bodyToRigidBody.get(body);
  if (rb) rb.setGravityScale(factor, true);
}

export function getGravityFactor(state: RapierPluginState, body: PhysicsBody): number {
  const rb = state.bodyToRigidBody.get(body);
  return rb?.gravityScale() ?? 1;
}

export function setTargetTransform(state: RapierPluginState, body: PhysicsBody, position: Vector3, rotation: Quaternion): void {
  const rb = state.bodyToRigidBody.get(body);
  if (!rb) return;

  rb.setNextKinematicTranslation(new state.rapier.Vector3(position.x, position.y, position.z));
  rb.setNextKinematicRotation(new state.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
}
