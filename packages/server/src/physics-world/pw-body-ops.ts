import type {
  BodyDescriptor,
  Vec3,
  Quat,
  ContainerShapeParams,
} from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';
import { createColliderDesc } from './pw-shape-utils.js';

export function addBody(ctx: PhysicsWorldContext, descriptor: BodyDescriptor): string {
  const { rapier, world } = ctx;
  const { id, shape, motionType, position, rotation, mass, centerOfMass, restitution, friction, isTrigger } = descriptor;

  if (ctx.bodyMap.has(id)) {
    throw new Error(`Body with id "${id}" already exists`);
  }

  let bodyDesc: import('@dimforge/rapier3d-compat').RigidBodyDesc;
  switch (motionType) {
    case 'dynamic':
      bodyDesc = rapier.RigidBodyDesc.dynamic();
      break;
    case 'static':
      bodyDesc = rapier.RigidBodyDesc.fixed();
      break;
    case 'kinematic':
      bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased();
      break;
  }

  bodyDesc.setTranslation(position.x, position.y, position.z);
  bodyDesc.setRotation(new rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));

  const rigidBody = world.createRigidBody(bodyDesc);
  if (motionType === 'dynamic') {
    rigidBody.enableCcd(true);
  }

  const applyColliderProps = (desc: import('@dimforge/rapier3d-compat').ColliderDesc): void => {
    if (centerOfMass !== undefined && motionType === 'dynamic') {
      const m = mass ?? 1.0;
      desc.setMassProperties(
        m,
        { x: centerOfMass.x, y: centerOfMass.y, z: centerOfMass.z },
        { x: m / 6, y: m / 6, z: m / 6 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    } else if (mass !== undefined && motionType === 'dynamic') {
      desc.setMass(mass);
    }
    if (restitution !== undefined) desc.setRestitution(restitution);
    if (friction !== undefined) desc.setFriction(friction);
    if (isTrigger) desc.setSensor(true);
    desc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
  };

  const colliders: import('@dimforge/rapier3d-compat').Collider[] = [];

  if (shape.type === 'container') {
    const cp = shape.params as ContainerShapeParams;
    for (const child of cp.children) {
      const childDesc = createColliderDesc(rapier, child.shape);
      if (!childDesc) continue;
      if (child.translation) {
        childDesc.setTranslation(child.translation.x, child.translation.y, child.translation.z);
      }
      if (child.rotation) {
        childDesc.setRotation(new rapier.Quaternion(child.rotation.x, child.rotation.y, child.rotation.z, child.rotation.w));
      }
      applyColliderProps(childDesc);
      const col = world.createCollider(childDesc, rigidBody);
      ctx.colliderHandleToBodyId.set(col.handle, id);
      colliders.push(col);
    }
  } else {
    const colliderDesc = createColliderDesc(rapier, shape);
    if (colliderDesc) {
      applyColliderProps(colliderDesc);
      const col = world.createCollider(colliderDesc, rigidBody);
      ctx.colliderHandleToBodyId.set(col.handle, id);
      colliders.push(col);
    }
  }

  ctx.bodyMap.set(id, rigidBody);
  ctx.colliderMap.set(id, colliders);

  return id;
}

export function removeBody(ctx: PhysicsWorldContext, id: string): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  const colliders = ctx.colliderMap.get(id);
  if (colliders) {
    for (const col of colliders) {
      ctx.colliderHandleToBodyId.delete(col.handle);
    }
  }

  ctx.world.removeRigidBody(body);
  ctx.bodyMap.delete(id);
  ctx.colliderMap.delete(id);
}

export function applyForce(ctx: PhysicsWorldContext, id: string, force: Vec3, point?: Vec3): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  if (point) {
    body.addForceAtPoint(
      new ctx.rapier.Vector3(force.x, force.y, force.z),
      new ctx.rapier.Vector3(point.x, point.y, point.z),
      true,
    );
  } else {
    body.addForce(new ctx.rapier.Vector3(force.x, force.y, force.z), true);
  }
}

export function applyImpulse(ctx: PhysicsWorldContext, id: string, impulse: Vec3, point?: Vec3): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  if (point) {
    body.applyImpulseAtPoint(
      new ctx.rapier.Vector3(impulse.x, impulse.y, impulse.z),
      new ctx.rapier.Vector3(point.x, point.y, point.z),
      true,
    );
  } else {
    body.applyImpulse(new ctx.rapier.Vector3(impulse.x, impulse.y, impulse.z), true);
  }
}

export function setBodyVelocity(ctx: PhysicsWorldContext, id: string, linVel: Vec3, angVel?: Vec3): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  body.setLinvel(new ctx.rapier.Vector3(linVel.x, linVel.y, linVel.z), true);
  if (angVel) {
    body.setAngvel(new ctx.rapier.Vector3(angVel.x, angVel.y, angVel.z), true);
  }
}

export function setBodyPosition(ctx: PhysicsWorldContext, id: string, position: Vec3): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  body.setTranslation(new ctx.rapier.Vector3(position.x, position.y, position.z), true);
}

export function setBodyRotation(ctx: PhysicsWorldContext, id: string, rotation: Quat): void {
  const body = ctx.bodyMap.get(id);
  if (!body) return;

  body.setRotation(
    new ctx.rapier.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    true,
  );
}
