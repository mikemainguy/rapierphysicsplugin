import type { BodyState, RoomSnapshot } from '@havokserver/shared';
import type { PhysicsWorld } from './physics-world.js';

export class StateManager {
  private lastBroadcastStates: Map<string, BodyState> = new Map();

  createSnapshot(world: PhysicsWorld, tick: number): RoomSnapshot {
    return {
      tick,
      timestamp: Date.now(),
      bodies: world.getSnapshot(),
    };
  }

  createDelta(world: PhysicsWorld, tick: number): RoomSnapshot {
    const allBodies = world.getSnapshot();
    const changedBodies: BodyState[] = [];

    for (const body of allBodies) {
      const prev = this.lastBroadcastStates.get(body.id);
      if (!prev || hasChanged(prev, body)) {
        changedBodies.push(body);
      }
    }

    // Update cache
    for (const body of allBodies) {
      this.lastBroadcastStates.set(body.id, body);
    }

    // Remove bodies no longer in simulation
    const currentIds = new Set(allBodies.map(b => b.id));
    for (const id of this.lastBroadcastStates.keys()) {
      if (!currentIds.has(id)) {
        this.lastBroadcastStates.delete(id);
      }
    }

    return {
      tick,
      timestamp: Date.now(),
      bodies: changedBodies,
    };
  }

  removeBody(id: string): void {
    this.lastBroadcastStates.delete(id);
  }

  clear(): void {
    this.lastBroadcastStates.clear();
  }
}

const EPSILON = 0.0001;

function hasChanged(a: BodyState, b: BodyState): boolean {
  return (
    Math.abs(a.position.x - b.position.x) > EPSILON ||
    Math.abs(a.position.y - b.position.y) > EPSILON ||
    Math.abs(a.position.z - b.position.z) > EPSILON ||
    Math.abs(a.rotation.x - b.rotation.x) > EPSILON ||
    Math.abs(a.rotation.y - b.rotation.y) > EPSILON ||
    Math.abs(a.rotation.z - b.rotation.z) > EPSILON ||
    Math.abs(a.rotation.w - b.rotation.w) > EPSILON ||
    Math.abs(a.linVel.x - b.linVel.x) > EPSILON ||
    Math.abs(a.linVel.y - b.linVel.y) > EPSILON ||
    Math.abs(a.linVel.z - b.linVel.z) > EPSILON ||
    Math.abs(a.angVel.x - b.angVel.x) > EPSILON ||
    Math.abs(a.angVel.y - b.angVel.y) > EPSILON ||
    Math.abs(a.angVel.z - b.angVel.z) > EPSILON
  );
}
