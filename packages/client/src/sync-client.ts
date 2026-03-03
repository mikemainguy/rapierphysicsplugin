import type {
  BodyDescriptor,
  BodyState,
  CollisionEventData,
  ConstraintDescriptor,
  RoomSnapshot,
  InputAction,
  ClientMessage,
  ServerMessage,
  ClientInput,
} from '@rapierphysicsplugin/shared';
import {
  MessageType,
  encodeMessage,
  decodeServerMessage,
  FIELD_POSITION,
  FIELD_ROTATION,
  FIELD_LIN_VEL,
  FIELD_ANG_VEL,
  OPCODE_MESH_BINARY,
  decodeMeshBinary,
  OPCODE_GEOMETRY_DEF,
  OPCODE_MESH_REF,
  OPCODE_MATERIAL_DEF,
  OPCODE_TEXTURE_DEF,
  decodeGeometryDef,
  decodeMeshRef,
  decodeMaterialDef,
  decodeTextureDef,
} from '@rapierphysicsplugin/shared';
import type { MeshBinaryMessage, GeometryDefData, MeshRefData, MaterialDefData, TextureDefData } from '@rapierphysicsplugin/shared';
import { ClockSyncClient } from './clock-sync.js';
import { StateReconciler } from './state-reconciler.js';
import { Interpolator } from './interpolator.js';
import { InputManager } from './input-manager.js';

type StateUpdateCallback = (state: RoomSnapshot) => void;
type BodyAddedCallback = (body: BodyDescriptor) => void;
type BodyRemovedCallback = (bodyId: string) => void;
type SimulationStartedCallback = (snapshot: RoomSnapshot) => void;
type CollisionEventsCallback = (events: CollisionEventData[]) => void;
type ConstraintAddedCallback = (constraint: ConstraintDescriptor) => void;
type ConstraintRemovedCallback = (constraintId: string) => void;
type MeshBinaryCallback = (msg: MeshBinaryMessage) => void;
type GeometryDefCallback = (data: GeometryDefData) => void;
type MeshRefCallback = (data: MeshRefData) => void;
type MaterialDefCallback = (data: MaterialDefData) => void;
type TextureDefCallback = (data: TextureDefData) => void;

export class PhysicsSyncClient {
  private ws: WebSocket | null = null;
  private clockSync: ClockSyncClient;
  private reconciler: StateReconciler;
  private inputManager: InputManager;
  private clientId: string | null = null;
  private roomId: string | null = null;

  // Body ID mapping for numeric wire format
  private indexToId: Map<number, string> = new Map();
  private idToIndex: Map<string, number> = new Map();

  // Full state map — merges partial delta updates into complete body states
  private fullStateMap: Map<string, BodyState> = new Map();

  private _simulationRunning = false;
  private _bytesSent = 0;
  private _bytesReceived = 0;
  private stateUpdateCallbacks: StateUpdateCallback[] = [];
  private bodyAddedCallbacks: BodyAddedCallback[] = [];
  private bodyRemovedCallbacks: BodyRemovedCallback[] = [];
  private simulationStartedCallbacks: SimulationStartedCallback[] = [];
  private collisionEventsCallbacks: CollisionEventsCallback[] = [];
  private constraintAddedCallbacks: ConstraintAddedCallback[] = [];
  private constraintRemovedCallbacks: ConstraintRemovedCallback[] = [];
  private meshBinaryCallbacks: MeshBinaryCallback[] = [];
  private geometryDefCallbacks: GeometryDefCallback[] = [];
  private meshRefCallbacks: MeshRefCallback[] = [];
  private materialDefCallbacks: MaterialDefCallback[] = [];
  private textureDefCallbacks: TextureDefCallback[] = [];

  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;
  private joinResolve: ((snapshot: RoomSnapshot) => void) | null = null;
  private createResolve: (() => void) | null = null;

  constructor() {
    this.clockSync = new ClockSyncClient();
    const interpolator = new Interpolator();
    this.reconciler = new StateReconciler(interpolator);
    this.inputManager = new InputManager();
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.clockSync.start((data) => {
          this._bytesSent += data.byteLength;
          this.ws?.send(data);
        });
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
      };

      this.ws.onmessage = async (event) => {
        let buf: Uint8Array;
        if (event.data instanceof ArrayBuffer) {
          buf = new Uint8Array(event.data);
        } else if (event.data instanceof Blob) {
          buf = new Uint8Array(await event.data.arrayBuffer());
        } else {
          console.warn('[SyncClient] Unexpected message data type:', typeof event.data);
          return;
        }
        this._bytesReceived += buf.byteLength;
        try {
          // Intercept mesh binary messages directly — skip normal decode path
          if (buf[0] === OPCODE_MESH_BINARY) {
            const decoded = decodeMeshBinary(buf);
            const msg: MeshBinaryMessage = { type: MessageType.MESH_BINARY, ...decoded };
            for (const cb of this.meshBinaryCallbacks) {
              cb(msg);
            }
            return;
          }

          // Intercept geometry def messages
          if (buf[0] === OPCODE_GEOMETRY_DEF) {
            const decoded = decodeGeometryDef(buf);
            for (const cb of this.geometryDefCallbacks) {
              cb(decoded);
            }
            return;
          }

          // Intercept mesh ref messages
          if (buf[0] === OPCODE_MESH_REF) {
            const decoded = decodeMeshRef(buf);
            for (const cb of this.meshRefCallbacks) {
              cb(decoded);
            }
            return;
          }

          // Intercept material def messages
          if (buf[0] === OPCODE_MATERIAL_DEF) {
            const decoded = decodeMaterialDef(buf);
            for (const cb of this.materialDefCallbacks) {
              cb(decoded);
            }
            return;
          }

          // Intercept texture def messages
          if (buf[0] === OPCODE_TEXTURE_DEF) {
            const decoded = decodeTextureDef(buf);
            for (const cb of this.textureDefCallbacks) {
              cb(decoded);
            }
            return;
          }
          const message = decodeServerMessage(buf, this.indexToId);
          this.handleMessage(message);
        } catch (err) {
          console.warn(
            `[SyncClient] Failed to decode server message (${buf.byteLength} bytes, opcode=0x${buf[0]?.toString(16)}):`,
            err,
          );
        }
      };

      this.ws.onclose = () => {
        this.clockSync.stop();
        this.inputManager.stop();
      };

      this.ws.onerror = (event) => {
        this.connectReject?.(new Error('WebSocket connection failed'));
        this.connectResolve = null;
        this.connectReject = null;
      };
    });
  }

  createRoom(roomId: string, initialBodies: BodyDescriptor[], gravity?: { x: number; y: number; z: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      this.createResolve = resolve;

      this.send({
        type: MessageType.CREATE_ROOM,
        roomId,
        initialBodies,
        gravity,
      });
    });
  }

  joinRoom(roomId: string): Promise<RoomSnapshot> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      this.joinResolve = resolve;

      this.send({
        type: MessageType.JOIN_ROOM,
        roomId,
      });
    });
  }

  leaveRoom(): void {
    if (!this.ws || !this.roomId) return;

    this.send({ type: MessageType.LEAVE_ROOM });
    this.roomId = null;
    this.inputManager.stop();
    this.reconciler.clear();
    this.fullStateMap.clear();
    this.indexToId.clear();
    this.idToIndex.clear();
  }

  sendInput(actions: InputAction[]): void {
    for (const action of actions) {
      this.inputManager.queueAction(action);
    }
  }

  addLocalBody(bodyId: string): void {
    this.reconciler.addLocalBody(bodyId);
  }

  removeLocalBody(bodyId: string): void {
    this.reconciler.removeLocalBody(bodyId);
  }

  addBody(body: BodyDescriptor): void {
    if (!this.ws) return;
    this.send({ type: MessageType.ADD_BODY, body });
  }

  removeBody(bodyId: string): void {
    if (!this.ws) return;
    this.send({ type: MessageType.REMOVE_BODY, bodyId });
  }

  addConstraint(constraint: ConstraintDescriptor): void {
    if (!this.ws) return;
    this.send({ type: MessageType.ADD_CONSTRAINT, constraint });
  }

  removeConstraint(constraintId: string): void {
    if (!this.ws) return;
    this.send({ type: MessageType.REMOVE_CONSTRAINT, constraintId });
  }

  onStateUpdate(callback: StateUpdateCallback): void {
    this.stateUpdateCallbacks.push(callback);
  }

  onBodyAdded(callback: BodyAddedCallback): void {
    this.bodyAddedCallbacks.push(callback);
  }

  onBodyRemoved(callback: BodyRemovedCallback): void {
    this.bodyRemovedCallbacks.push(callback);
  }

  onSimulationStarted(callback: SimulationStartedCallback): void {
    this.simulationStartedCallbacks.push(callback);
  }

  onCollisionEvents(callback: CollisionEventsCallback): void {
    this.collisionEventsCallbacks.push(callback);
  }

  onConstraintAdded(callback: ConstraintAddedCallback): void {
    this.constraintAddedCallbacks.push(callback);
  }

  onConstraintRemoved(callback: ConstraintRemovedCallback): void {
    this.constraintRemovedCallbacks.push(callback);
  }

  onMeshBinary(callback: MeshBinaryCallback): void {
    this.meshBinaryCallbacks.push(callback);
  }

  onGeometryDef(callback: GeometryDefCallback): void {
    this.geometryDefCallbacks.push(callback);
  }

  onMeshRef(callback: MeshRefCallback): void {
    this.meshRefCallbacks.push(callback);
  }

  onMaterialDef(callback: MaterialDefCallback): void {
    this.materialDefCallbacks.push(callback);
  }

  onTextureDef(callback: TextureDefCallback): void {
    this.textureDefCallbacks.push(callback);
  }

  /** Send pre-encoded binary mesh data directly over the WebSocket (no msgpackr wrapping). */
  sendMeshBinary(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  /** Send pre-encoded GEOMETRY_DEF directly over the WebSocket. */
  sendGeometryDef(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  /** Send pre-encoded MESH_REF directly over the WebSocket. */
  sendMeshRef(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  /** Send pre-encoded MATERIAL_DEF directly over the WebSocket. */
  sendMaterialDef(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  /** Send pre-encoded TEXTURE_DEF directly over the WebSocket. */
  sendTextureDef(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  startSimulation(): void {
    if (!this.ws) return;
    this.send({ type: MessageType.START_SIMULATION });
  }

  get simulationRunning(): boolean {
    return this._simulationRunning;
  }

  /** Total number of bodies the client knows about (including sleeping/unchanged ones) */
  get totalBodyCount(): number {
    return this.fullStateMap.size;
  }

  disconnect(): void {
    this.clockSync.stop();
    this.inputManager.stop();
    this.reconciler.clear();
    this.fullStateMap.clear();
    this.indexToId.clear();
    this.idToIndex.clear();
    this.ws?.close();
    this.ws = null;
    this.roomId = null;
    this.clientId = null;
  }

  private initBodyIdMap(bodyIdMap: Record<string, number>): void {
    this.indexToId.clear();
    this.idToIndex.clear();
    for (const [id, index] of Object.entries(bodyIdMap)) {
      this.indexToId.set(index, id);
      this.idToIndex.set(id, index);
    }
  }

  private addBodyIdMapping(id: string, index: number): void {
    this.indexToId.set(index, id);
    this.idToIndex.set(id, index);
  }

  private initFullState(bodies: BodyState[]): void {
    this.fullStateMap.clear();
    for (const body of bodies) {
      this.fullStateMap.set(body.id, { ...body });
    }
  }

  /**
   * Merge partial delta bodies into the full state map.
   * Returns the merged (complete) body states for the bodies that were in the delta.
   */
  private mergeDelta(bodies: BodyState[]): BodyState[] {
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
          // No fieldMask = full update
          existing.position = body.position;
          existing.rotation = body.rotation;
          existing.linVel = body.linVel;
          existing.angVel = body.angVel;
        }
        merged.push(existing);
      } else {
        // New body — add to map
        const newBody: BodyState = { ...body };
        delete newBody.fieldMask;
        this.fullStateMap.set(body.id, newBody);
        merged.push(newBody);
      }
    }
    return merged;
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case MessageType.CLOCK_SYNC_RESPONSE:
        this.clockSync.handleResponse(message);
        break;

      case MessageType.ROOM_CREATED:
        this.createResolve?.();
        this.createResolve = null;
        break;

      case MessageType.ROOM_JOINED:
        this.roomId = message.roomId;
        this.clientId = message.clientId;
        this._simulationRunning = message.simulationRunning;

        // Initialize body ID mapping
        if (message.bodyIdMap) {
          this.initBodyIdMap(message.bodyIdMap);
        }

        // Initialize full state from snapshot
        this.initFullState(message.snapshot.bodies);

        // Start input manager
        this.inputManager.start(
          (input) => this.sendClientInput(input),
          () => this.clockSync.getServerTick()
        );

        // Notify about existing constraints
        if (message.constraints) {
          for (const c of message.constraints) {
            for (const cb of this.constraintAddedCallbacks) {
              cb(c);
            }
          }
        }

        // Replay body descriptors for late joiners
        if (message.bodies) {
          for (const b of message.bodies) {
            if (message.bodyIdMap && message.bodyIdMap[b.id] !== undefined) {
              this.addBodyIdMapping(b.id, message.bodyIdMap[b.id]);
            }
            for (const cb of this.bodyAddedCallbacks) {
              cb(b);
            }
          }
        }

        this.joinResolve?.(message.snapshot);
        this.joinResolve = null;
        break;

      case MessageType.ROOM_STATE: {
        // Merge partial delta into full state map
        const mergedBodies = this.mergeDelta(message.bodies);

        const snapshot: RoomSnapshot = {
          tick: message.tick,
          timestamp: message.timestamp,
          bodies: mergedBodies,
        };

        // Process through reconciler
        this.reconciler.processServerState(snapshot);

        // Notify listeners
        for (const cb of this.stateUpdateCallbacks) {
          cb(snapshot);
        }
        break;
      }

      case MessageType.ADD_BODY:
        // Update body ID mapping
        if (message.bodyIndex !== undefined) {
          this.addBodyIdMapping(message.body.id, message.bodyIndex);
        }
        for (const cb of this.bodyAddedCallbacks) {
          cb(message.body);
        }
        break;

      case MessageType.REMOVE_BODY:
        this.fullStateMap.delete(message.bodyId);
        for (const cb of this.bodyRemovedCallbacks) {
          cb(message.bodyId);
        }
        break;

      case MessageType.SIMULATION_STARTED: {
        this._simulationRunning = true;
        this.reconciler.clear();

        // Re-initialize body ID mapping if provided
        const simMsg = message as ServerMessage & { bodyIdMap?: Record<string, number> };
        if (simMsg.bodyIdMap) {
          this.initBodyIdMap(simMsg.bodyIdMap);
        }

        // Re-initialize full state from fresh snapshot
        this.initFullState(message.snapshot.bodies);

        // Notify about constraints included in reset
        const simConstraints = (message as ServerMessage & { constraints?: ConstraintDescriptor[] }).constraints;
        if (simConstraints) {
          for (const c of simConstraints) {
            for (const cb of this.constraintAddedCallbacks) {
              cb(c);
            }
          }
        }

        // Replay body descriptors included in reset
        const simBodies = (message as ServerMessage & { bodies?: BodyDescriptor[] }).bodies;
        if (simBodies) {
          for (const b of simBodies) {
            for (const cb of this.bodyAddedCallbacks) {
              cb(b);
            }
          }
        }

        const startSnapshot = message.snapshot;
        for (const cb of this.simulationStartedCallbacks) {
          cb(startSnapshot);
        }
        break;
      }

      case MessageType.COLLISION_EVENTS:
        for (const cb of this.collisionEventsCallbacks) {
          cb(message.events);
        }
        break;

      case MessageType.ADD_CONSTRAINT:
        for (const cb of this.constraintAddedCallbacks) {
          cb(message.constraint);
        }
        break;

      case MessageType.REMOVE_CONSTRAINT:
        for (const cb of this.constraintRemovedCallbacks) {
          cb(message.constraintId);
        }
        break;

      case MessageType.ERROR:
        console.error(`Server error: ${message.message}`);
        break;
    }
  }

  private sendClientInput(input: ClientInput): void {
    this.reconciler.addPendingInput(input);
    this.send({
      type: MessageType.CLIENT_INPUT,
      input,
    });
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const encoded = encodeMessage(message);
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  getReconciler(): StateReconciler {
    return this.reconciler;
  }

  getClockSync(): ClockSyncClient {
    return this.clockSync;
  }

  getInputManager(): InputManager {
    return this.inputManager;
  }

  getClientId(): string | null {
    return this.clientId;
  }

  getRoomId(): string | null {
    return this.roomId;
  }

  get bytesSent(): number {
    return this._bytesSent;
  }

  get bytesReceived(): number {
    return this._bytesReceived;
  }
}
