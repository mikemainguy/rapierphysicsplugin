import type { BodyState, RoomSnapshot } from '@rapierphysicsplugin/shared';
import { FIELD_POSITION, FIELD_ROTATION, FIELD_LIN_VEL, FIELD_ANG_VEL, FIELD_ALL } from '@rapierphysicsplugin/shared';
import type { PhysicsWorld } from './physics-world.js';

export class StateManager {
  private lastBroadcastStates: Map<string, BodyState> = new Map();
  private bodyIdToIndex: Map<string, number> = new Map();
  private bodyIndexToId: Map<number, string> = new Map();
  private nextBodyIndex = 0;

  createSnapshot(world: PhysicsWorld, tick: number): RoomSnapshot {
    const bodies = world.getSnapshot();
    // Ensure all bodies have an index assigned
    for (const body of bodies) {
      this.ensureBodyIndex(body.id);
    }
    return {
      tick,
      timestamp: Date.now(),
      bodies,
    };
  }

  createDelta(world: PhysicsWorld, tick: number): RoomSnapshot & { isDelta: boolean } {
    const allBodies = world.getSnapshot();
    const changedBodies: BodyState[] = [];

    for (const body of allBodies) {
      this.ensureBodyIndex(body.id);
      const prev = this.lastBroadcastStates.get(body.id);
      if (!prev) {
        body.fieldMask = FIELD_ALL;
        changedBodies.push(body);
      } else {
        // Skip comparison for sleeping bodies (their state is unchanged)
        if (world.isBodySleeping(body.id)) continue;

        const mask = getChangedFields(prev, body);
        if (mask !== 0) {
          body.fieldMask = mask;
          changedBodies.push(body);
        }
      }
    }

    // Update cache
    for (const body of allBodies) {
      this.lastBroadcastStates.set(body.id, body);
    }

    // Remove bodies no longer in simulation
    for (const id of this.lastBroadcastStates.keys()) {
      if (!world.hasBody(id)) {
        this.lastBroadcastStates.delete(id);
      }
    }

    return {
      tick,
      timestamp: Date.now(),
      bodies: changedBodies,
      isDelta: true,
    };
  }

  ensureBodyIndex(id: string): number {
    let index = this.bodyIdToIndex.get(id);
    if (index === undefined) {
      index = this.nextBodyIndex++;
      this.bodyIdToIndex.set(id, index);
      this.bodyIndexToId.set(index, id);
    }
    return index;
  }

  getBodyIndex(id: string): number | undefined {
    return this.bodyIdToIndex.get(id);
  }

  getIdToIndexMap(): Map<string, number> {
    return this.bodyIdToIndex;
  }

  getIndexToIdMap(): Map<number, string> {
    return this.bodyIndexToId;
  }

  getIdToIndexRecord(): Record<string, number> {
    const record: Record<string, number> = {};
    for (const [id, index] of this.bodyIdToIndex) {
      record[id] = index;
    }
    return record;
  }

  removeBody(id: string): void {
    this.lastBroadcastStates.delete(id);
    // Note: we don't remove the index mapping — indices are never reused
    // to prevent desync with clients that haven't processed the removal yet
  }

  clear(): void {
    this.lastBroadcastStates.clear();
    this.bodyIdToIndex.clear();
    this.bodyIndexToId.clear();
    this.nextBodyIndex = 0;
  }
}

const EPSILON = 0.0001;

function vec3Changed(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return (
    Math.abs(a.x - b.x) > EPSILON ||
    Math.abs(a.y - b.y) > EPSILON ||
    Math.abs(a.z - b.z) > EPSILON
  );
}

function quatChanged(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): boolean {
  return (
    Math.abs(a.x - b.x) > EPSILON ||
    Math.abs(a.y - b.y) > EPSILON ||
    Math.abs(a.z - b.z) > EPSILON ||
    Math.abs(a.w - b.w) > EPSILON
  );
}

function getChangedFields(a: BodyState, b: BodyState): number {
  let mask = 0;
  if (vec3Changed(a.position, b.position)) mask |= FIELD_POSITION;
  if (quatChanged(a.rotation, b.rotation)) mask |= FIELD_ROTATION;
  if (vec3Changed(a.linVel, b.linVel)) mask |= FIELD_LIN_VEL;
  if (vec3Changed(a.angVel, b.angVel)) mask |= FIELD_ANG_VEL;
  return mask;
}
