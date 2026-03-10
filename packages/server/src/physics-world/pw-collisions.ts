import type RAPIER from '@dimforge/rapier3d-compat';
import type { CollisionEventData, Vec3 } from '@rapierphysicsplugin/shared';
import type { PhysicsWorldContext } from './pw-types.js';

interface ContactInfo {
  point: Vec3 | null;
  normal: Vec3 | null;
  impulse: number;
}

function extractContactInfo(
  world: RAPIER.World,
  collider1: RAPIER.Collider,
  collider2: RAPIER.Collider,
): ContactInfo {
  let point: Vec3 | null = null;
  let normal: Vec3 | null = null;
  let impulse = 0;

  world.contactPair(collider1, collider2, (manifold, flipped) => {
    const cp = manifold.localContactPoint1(0);
    if (cp) {
      point = { x: cp.x, y: cp.y, z: cp.z };
    }
    const n = manifold.localNormal1();
    if (n) {
      normal = flipped
        ? { x: -n.x, y: -n.y, z: -n.z }
        : { x: n.x, y: n.y, z: n.z };
    }
    impulse = manifold.contactImpulse(0) ?? 0;
  });

  return { point, normal, impulse };
}

export function stepWorld(ctx: PhysicsWorldContext): CollisionEventData[] {
  ctx.world.step(ctx.eventQueue);

  const events: CollisionEventData[] = [];
  const eventedPairs = new Set<string>();

  ctx.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    const bodyIdA = ctx.colliderHandleToBodyId.get(handle1);
    const bodyIdB = ctx.colliderHandleToBodyId.get(handle2);
    if (!bodyIdA || !bodyIdB) return;

    const collider1 = ctx.world.getCollider(handle1);
    const collider2 = ctx.world.getCollider(handle2);
    if (!collider1 || !collider2) return;

    const isSensor = collider1.isSensor() || collider2.isSensor();
    const pairKey = handle1 < handle2 ? `${handle1}_${handle2}` : `${handle2}_${handle1}`;
    eventedPairs.add(pairKey);

    let type: CollisionEventData['type'];
    if (isSensor) {
      type = started ? 'TRIGGER_ENTERED' : 'TRIGGER_EXITED';
    } else if (started) {
      type = 'COLLISION_STARTED';
      ctx.activeCollisionPairs.add(pairKey);
    } else {
      type = 'COLLISION_FINISHED';
      ctx.activeCollisionPairs.delete(pairKey);
    }

    let point: Vec3 | null = null;
    let normal: Vec3 | null = null;
    let impulse = 0;

    if (started && !isSensor) {
      ({ point, normal, impulse } = extractContactInfo(ctx.world, collider1, collider2));
    }

    events.push({ bodyIdA, bodyIdB, type, point, normal, impulse });
  });

  // Emit COLLISION_CONTINUED for active pairs with no Rapier event this frame
  for (const pairKey of ctx.activeCollisionPairs) {
    if (eventedPairs.has(pairKey)) continue;

    const [h1Str, h2Str] = pairKey.split('_');
    const handle1 = Number(h1Str);
    const handle2 = Number(h2Str);

    const bodyIdA = ctx.colliderHandleToBodyId.get(handle1);
    const bodyIdB = ctx.colliderHandleToBodyId.get(handle2);
    if (!bodyIdA || !bodyIdB) {
      ctx.activeCollisionPairs.delete(pairKey);
      continue;
    }

    const collider1 = ctx.world.getCollider(handle1);
    const collider2 = ctx.world.getCollider(handle2);
    if (!collider1 || !collider2) {
      ctx.activeCollisionPairs.delete(pairKey);
      continue;
    }

    const { point, normal, impulse } = extractContactInfo(ctx.world, collider1, collider2);
    events.push({ bodyIdA, bodyIdB, type: 'COLLISION_CONTINUED', point, normal, impulse });
  }

  return events;
}
