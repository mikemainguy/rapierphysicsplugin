import type { InputAction } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';
import { applyForce, applyImpulse, setBodyVelocity, setBodyPosition, setBodyRotation } from './pw-body-ops.js';

export function applyInput(ctx: PhysicsWorldContext, action: InputAction): void {
  switch (action.type) {
    case 'applyForce':
      if (action.data.force) {
        applyForce(ctx, action.bodyId, action.data.force, action.data.point);
      }
      break;
    case 'applyImpulse':
      if (action.data.impulse) {
        applyImpulse(ctx, action.bodyId, action.data.impulse, action.data.point);
      }
      break;
    case 'setVelocity':
      if (action.data.linVel) {
        setBodyVelocity(ctx, action.bodyId, action.data.linVel, action.data.angVel);
      }
      break;
    case 'applyAngularImpulse':
      if (action.data.angImpulse) {
        const body = ctx.bodyMap.get(action.bodyId);
        if (body) {
          body.applyTorqueImpulse(
            new ctx.rapier.Vector3(action.data.angImpulse.x, action.data.angImpulse.y, action.data.angImpulse.z),
            true,
          );
        }
      }
      break;
    case 'applyTorque':
      if (action.data.torque) {
        const body = ctx.bodyMap.get(action.bodyId);
        if (body) {
          body.addTorque(
            new ctx.rapier.Vector3(action.data.torque.x, action.data.torque.y, action.data.torque.z),
            true,
          );
        }
      }
      break;
    case 'setAngularVelocity':
      if (action.data.angVel) {
        const body = ctx.bodyMap.get(action.bodyId);
        if (body) {
          body.setAngvel(
            new ctx.rapier.Vector3(action.data.angVel.x, action.data.angVel.y, action.data.angVel.z),
            true,
          );
        }
      }
      break;
    case 'setPosition':
      if (action.data.position) {
        setBodyPosition(ctx, action.bodyId, action.data.position);
      }
      break;
    case 'setRotation':
      if (action.data.rotation) {
        setBodyRotation(ctx, action.bodyId, action.data.rotation);
      }
      break;
  }
}
