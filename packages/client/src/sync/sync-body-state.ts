import type { BodyState } from '@rapierphysicsplugin/shared';
import {
  FIELD_POSITION,
  FIELD_ROTATION,
  FIELD_LIN_VEL,
  FIELD_ANG_VEL,
} from '@rapierphysicsplugin/shared';

export class BodyStateTracker {
  readonly indexToId = new Map<number, string>();
  readonly idToIndex = new Map<string, number>();
  readonly fullStateMap = new Map<string, BodyState>();

  initBodyIdMap(bodyIdMap: Record<string, number>): void {
    this.indexToId.clear();
    this.idToIndex.clear();
    for (const [id, index] of Object.entries(bodyIdMap)) {
      this.indexToId.set(index, id);
      this.idToIndex.set(id, index);
    }
  }

  addBodyIdMapping(id: string, index: number): void {
    this.indexToId.set(index, id);
    this.idToIndex.set(id, index);
  }

  initFullState(bodies: BodyState[]): void {
    this.fullStateMap.clear();
    for (const body of bodies) {
      this.fullStateMap.set(body.id, { ...body });
    }
  }

  /**
   * Merge partial delta bodies into the full state map.
   * Returns the merged (complete) body states for the bodies that were in the delta.
   */
  mergeDelta(bodies: BodyState[]): BodyState[] {
    const merged: BodyState[] = [];
    for (const body of bodies) {
      const existing = this.fullStateMap.get(body.id);
      if (existing) {
        const mask = body.fieldMask;
        if (mask !== undefined) {
          if (mask & FIELD_POSITION) existing.position = body.position;
          if (mask & FIELD_ROTATION) existing.rotation = body.rotation;
          if (mask & FIELD_LIN_VEL) existing.linVel = body.linVel;
          if (mask & FIELD_ANG_VEL) existing.angVel = body.angVel;
        } else {
          existing.position = body.position;
          existing.rotation = body.rotation;
          existing.linVel = body.linVel;
          existing.angVel = body.angVel;
        }
        merged.push(existing);
      } else {
        const newBody: BodyState = { ...body };
        delete newBody.fieldMask;
        this.fullStateMap.set(body.id, newBody);
        merged.push(newBody);
      }
    }
    return merged;
  }

  removeBody(bodyId: string): void {
    this.fullStateMap.delete(bodyId);
  }

  clear(): void {
    this.indexToId.clear();
    this.idToIndex.clear();
    this.fullStateMap.clear();
  }
}
