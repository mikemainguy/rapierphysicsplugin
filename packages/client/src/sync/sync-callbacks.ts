import type {
  RoomSnapshot,
  BodyDescriptor,
  CollisionEventData,
  ConstraintDescriptor,
  ConstraintUpdates,
  MeshBinaryMessage,
  GeometryDefData,
  MeshRefData,
  MaterialDefData,
  TextureDefData,
} from '@rapierphysicsplugin/shared';

export type StateUpdateCallback = (state: RoomSnapshot) => void;
export type BodyAddedCallback = (body: BodyDescriptor) => void;
export type BodyRemovedCallback = (bodyId: string) => void;
export type SimulationStartedCallback = (snapshot: RoomSnapshot) => void;
export type CollisionEventsCallback = (events: CollisionEventData[]) => void;
export type ConstraintAddedCallback = (constraint: ConstraintDescriptor) => void;
export type ConstraintRemovedCallback = (constraintId: string) => void;
export type ConstraintUpdatedCallback = (constraintId: string, updates: ConstraintUpdates) => void;
export type MeshBinaryCallback = (msg: MeshBinaryMessage) => void;
export type GeometryDefCallback = (data: GeometryDefData) => void;
export type MeshRefCallback = (data: MeshRefData) => void;
export type MaterialDefCallback = (data: MaterialDefData) => void;
export type TextureDefCallback = (data: TextureDefData) => void;

export class SyncCallbacks {
  readonly stateUpdate: StateUpdateCallback[] = [];
  readonly bodyAdded: BodyAddedCallback[] = [];
  readonly bodyRemoved: BodyRemovedCallback[] = [];
  readonly simulationStarted: SimulationStartedCallback[] = [];
  readonly collisionEvents: CollisionEventsCallback[] = [];
  readonly constraintAdded: ConstraintAddedCallback[] = [];
  readonly constraintRemoved: ConstraintRemovedCallback[] = [];
  readonly constraintUpdated: ConstraintUpdatedCallback[] = [];
  readonly meshBinary: MeshBinaryCallback[] = [];
  readonly geometryDef: GeometryDefCallback[] = [];
  readonly meshRef: MeshRefCallback[] = [];
  readonly materialDef: MaterialDefCallback[] = [];
  readonly textureDef: TextureDefCallback[] = [];

  onStateUpdate(callback: StateUpdateCallback): void { this.stateUpdate.push(callback); }
  onBodyAdded(callback: BodyAddedCallback): void { this.bodyAdded.push(callback); }
  onBodyRemoved(callback: BodyRemovedCallback): void { this.bodyRemoved.push(callback); }
  onSimulationStarted(callback: SimulationStartedCallback): void { this.simulationStarted.push(callback); }
  onCollisionEvents(callback: CollisionEventsCallback): void { this.collisionEvents.push(callback); }
  onConstraintAdded(callback: ConstraintAddedCallback): void { this.constraintAdded.push(callback); }
  onConstraintRemoved(callback: ConstraintRemovedCallback): void { this.constraintRemoved.push(callback); }
  onConstraintUpdated(callback: ConstraintUpdatedCallback): void { this.constraintUpdated.push(callback); }
  onMeshBinary(callback: MeshBinaryCallback): void { this.meshBinary.push(callback); }
  onGeometryDef(callback: GeometryDefCallback): void { this.geometryDef.push(callback); }
  onMeshRef(callback: MeshRefCallback): void { this.meshRef.push(callback); }
  onMaterialDef(callback: MaterialDefCallback): void { this.materialDef.push(callback); }
  onTextureDef(callback: TextureDefCallback): void { this.textureDef.push(callback); }
}
