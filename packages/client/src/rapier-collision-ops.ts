import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, PhysicsEventType } from '@babylonjs/core';
import type {
  PhysicsBody,
  IPhysicsCollisionEvent,
  IBasePhysicsCollisionEvent,
  Nullable,
} from '@babylonjs/core';
import type { CollisionEventData } from '@rapierphysicsplugin/shared';
import type { RapierPluginState } from './rapier-types.js';

export function processCollisionEvents(
  state: RapierPluginState,
  eventQueue: RAPIER.EventQueue,
): void {
  eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
    const body1 = state.colliderHandleToBody.get(handle1);
    const body2 = state.colliderHandleToBody.get(handle2);
    if (!body1 || !body2) return;

    const collider1 = state.world.getCollider(handle1);
    const collider2 = state.world.getCollider(handle2);
    if (!collider1 || !collider2) return;

    const isSensor = collider1.isSensor() || collider2.isSensor();

    if (isSensor) {
      const eventType = started ? PhysicsEventType.TRIGGER_ENTERED : PhysicsEventType.TRIGGER_EXITED;
      const baseEvent1: IBasePhysicsCollisionEvent = {
        collider: body1,
        collidedAgainst: body2,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };
      const baseEvent2: IBasePhysicsCollisionEvent = {
        collider: body2,
        collidedAgainst: body1,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };

      state.onTriggerCollisionObservable.notifyObservers(baseEvent1);

      if (state.collisionCallbackEnabled.has(body1)) {
        const triggerEvent: IPhysicsCollisionEvent = { ...baseEvent1, point: null, normal: null, distance: 0, impulse: 0 };
        state.bodyCollisionObservables.get(body1)?.notifyObservers(triggerEvent);
      }
      if (state.collisionCallbackEnabled.has(body2)) {
        const triggerEvent: IPhysicsCollisionEvent = { ...baseEvent2, point: null, normal: null, distance: 0, impulse: 0 };
        state.bodyCollisionObservables.get(body2)?.notifyObservers(triggerEvent);
      }
    } else if (started) {
      let point: Nullable<Vector3> = null;
      let normal: Nullable<Vector3> = null;
      let impulse = 0;

      state.world.contactPair(collider1, collider2, (manifold, flipped) => {
        const n = manifold.normal();
        normal = flipped
          ? new Vector3(-n.x, -n.y, -n.z)
          : new Vector3(n.x, n.y, n.z);

        if (manifold.numContacts() > 0) {
          const cp = manifold.localContactPoint1(0);
          if (cp) {
            const t = collider1.translation();
            point = new Vector3(cp.x + t.x, cp.y + t.y, cp.z + t.z);
          }
          impulse = manifold.contactImpulse(0);
        }
      });

      const eventType = PhysicsEventType.COLLISION_STARTED;
      const fullEvent1: IPhysicsCollisionEvent = {
        collider: body1,
        collidedAgainst: body2,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
        point,
        normal,
        distance: 0,
        impulse,
      };
      const fullEvent2: IPhysicsCollisionEvent = {
        collider: body2,
        collidedAgainst: body1,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
        point,
        normal: normal ? (normal as Vector3).negate() : null,
        distance: 0,
        impulse,
      };

      state.onCollisionObservable.notifyObservers(fullEvent1);

      if (state.collisionCallbackEnabled.has(body1)) {
        state.bodyCollisionObservables.get(body1)?.notifyObservers(fullEvent1);
      }
      if (state.collisionCallbackEnabled.has(body2)) {
        state.bodyCollisionObservables.get(body2)?.notifyObservers(fullEvent2);
      }
    } else {
      const eventType = PhysicsEventType.COLLISION_FINISHED;
      const baseEvent1: IBasePhysicsCollisionEvent = {
        collider: body1,
        collidedAgainst: body2,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };
      const baseEvent2: IBasePhysicsCollisionEvent = {
        collider: body2,
        collidedAgainst: body1,
        colliderIndex: 0,
        collidedAgainstIndex: 0,
        type: eventType,
      };

      state.onCollisionEndedObservable.notifyObservers(baseEvent1);

      if (state.collisionEndedCallbackEnabled.has(body1)) {
        state.bodyCollisionEndedObservables.get(body1)?.notifyObservers(baseEvent1);
      }
      if (state.collisionEndedCallbackEnabled.has(body2)) {
        state.bodyCollisionEndedObservables.get(body2)?.notifyObservers(baseEvent2);
      }
    }
  });
}

export function injectCollisionEvents(state: RapierPluginState, events: CollisionEventData[]): void {
  for (const event of events) {
    const bodyA = state.bodyIdToPhysicsBody.get(event.bodyIdA);
    const bodyB = state.bodyIdToPhysicsBody.get(event.bodyIdB);
    if (!bodyA || !bodyB) continue;

    const point = event.point ? new Vector3(event.point.x, event.point.y, event.point.z) : null;
    const normal = event.normal ? new Vector3(event.normal.x, event.normal.y, event.normal.z) : null;

    const eventType = PhysicsEventType[event.type as keyof typeof PhysicsEventType];

    const baseEventA: IBasePhysicsCollisionEvent = {
      collider: bodyA,
      collidedAgainst: bodyB,
      colliderIndex: 0,
      collidedAgainstIndex: 0,
      type: eventType,
    };

    const baseEventB: IBasePhysicsCollisionEvent = {
      collider: bodyB,
      collidedAgainst: bodyA,
      colliderIndex: 0,
      collidedAgainstIndex: 0,
      type: eventType,
    };

    switch (event.type) {
      case 'COLLISION_STARTED': {
        const fullEventA: IPhysicsCollisionEvent = {
          ...baseEventA,
          point,
          normal,
          distance: 0,
          impulse: event.impulse,
        };
        const fullEventB: IPhysicsCollisionEvent = {
          ...baseEventB,
          point,
          normal: normal ? normal.negate() : null,
          distance: 0,
          impulse: event.impulse,
        };

        state.onCollisionObservable.notifyObservers(fullEventA);

        if (state.collisionCallbackEnabled.has(bodyA)) {
          state.bodyCollisionObservables.get(bodyA)?.notifyObservers(fullEventA);
        }
        if (state.collisionCallbackEnabled.has(bodyB)) {
          state.bodyCollisionObservables.get(bodyB)?.notifyObservers(fullEventB);
        }
        break;
      }
      case 'COLLISION_FINISHED': {
        state.onCollisionEndedObservable.notifyObservers(baseEventA);

        if (state.collisionEndedCallbackEnabled.has(bodyA)) {
          state.bodyCollisionEndedObservables.get(bodyA)?.notifyObservers(baseEventA);
        }
        if (state.collisionEndedCallbackEnabled.has(bodyB)) {
          state.bodyCollisionEndedObservables.get(bodyB)?.notifyObservers(baseEventB);
        }
        break;
      }
      case 'TRIGGER_ENTERED':
      case 'TRIGGER_EXITED': {
        state.onTriggerCollisionObservable.notifyObservers(baseEventA);

        if (state.collisionCallbackEnabled.has(bodyA)) {
          const triggerEventA: IPhysicsCollisionEvent = {
            ...baseEventA,
            point: null,
            normal: null,
            distance: 0,
            impulse: 0,
          };
          state.bodyCollisionObservables.get(bodyA)?.notifyObservers(triggerEventA);
        }
        if (state.collisionCallbackEnabled.has(bodyB)) {
          const triggerEventB: IPhysicsCollisionEvent = {
            ...baseEventB,
            point: null,
            normal: null,
            distance: 0,
            impulse: 0,
          };
          state.bodyCollisionObservables.get(bodyB)?.notifyObservers(triggerEventB);
        }
        break;
      }
    }
  }
}
