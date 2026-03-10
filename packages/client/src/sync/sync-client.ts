import type {
  BodyDescriptor,
  ConstraintDescriptor,
  ConstraintUpdates,
  RoomSnapshot,
  InputAction,
  ClientMessage,
  ShapeDescriptor,
  Vec3,
  Quat,
  ShapeCastResponse,
  ShapeProximityResponse,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import { MessageType, encodeMessage } from '@rapierphysicsplugin/shared';
import { ClockSyncClient } from './clock-sync.js';
import { StateReconciler } from './state-reconciler.js';
import { Interpolator } from './interpolator.js';
import { InputManager } from './input-manager.js';
import { BodyStateTracker } from './sync-body-state.js';
import { QueryManager } from './sync-queries.js';
import { SyncCallbacks } from './sync-callbacks.js';
import type {
  StateUpdateCallback,
  BodyAddedCallback,
  BodyRemovedCallback,
  SimulationStartedCallback,
  CollisionEventsCallback,
  ConstraintAddedCallback,
  ConstraintRemovedCallback,
  ConstraintUpdatedCallback,
  MeshBinaryCallback,
  GeometryDefCallback,
  MeshRefCallback,
  MaterialDefCallback,
  TextureDefCallback,
} from './sync-callbacks.js';
import { dispatchBinaryMessage } from './sync-message-handler.js';
import type { SyncClientMutableState } from './sync-message-handler.js';

export class PhysicsSyncClient {
  private ws: WebSocket | null = null;
  private clockSync: ClockSyncClient;
  private reconciler: StateReconciler;
  private inputManager: InputManager;
  private bodyState: BodyStateTracker;
  private queries: QueryManager;
  private callbacks: SyncCallbacks;
  private mutableState: SyncClientMutableState = {
    simulationRunning: false,
    roomId: null,
    clientId: null,
    createResolve: null,
    joinResolve: null,
  };

  private _bytesSent = 0;
  private _bytesReceived = 0;

  constructor(options?: {
    renderDelayMs?: number;
    interpolationBufferSize?: number;
    clockSyncIntervalMs?: number;
    clockSyncSamples?: number;
    reconciliationThreshold?: number;
  }) {
    this.clockSync = new ClockSyncClient(
      options?.clockSyncIntervalMs,
      options?.clockSyncSamples,
    );
    const interpolator = new Interpolator(
      options?.renderDelayMs,
      options?.interpolationBufferSize,
    );
    this.reconciler = new StateReconciler(interpolator, options?.reconciliationThreshold);
    this.inputManager = new InputManager();
    this.bodyState = new BodyStateTracker();
    this.callbacks = new SyncCallbacks();
    this.queries = new QueryManager(
      () => this.ws !== null,
      (msg) => this.send(msg),
    );
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let connectResolve: (() => void) | null = resolve;
      let connectReject: ((err: Error) => void) | null = reject;

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.clockSync.start((data) => {
          this._bytesSent += data.byteLength;
          this.ws?.send(data);
        });
        connectResolve?.();
        connectResolve = null;
        connectReject = null;
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
          dispatchBinaryMessage(buf, {
            state: this.mutableState,
            bodyState: this.bodyState,
            clockSync: this.clockSync,
            reconciler: this.reconciler,
            inputManager: this.inputManager,
            callbacks: this.callbacks,
            queries: this.queries,
            send: (msg) => this.send(msg),
          });
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
        this.queries.cleanup();
      };

      this.ws.onerror = () => {
        connectReject?.(new Error('WebSocket connection failed'));
        connectResolve = null;
        connectReject = null;
      };
    });
  }

  createRoom(roomId: string, initialBodies: BodyDescriptor[], gravity?: { x: number; y: number; z: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      this.mutableState.createResolve = resolve;

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

      this.mutableState.joinResolve = resolve;

      this.send({
        type: MessageType.JOIN_ROOM,
        roomId,
      });
    });
  }

  leaveRoom(): void {
    if (!this.ws || !this.mutableState.roomId) return;

    this.send({ type: MessageType.LEAVE_ROOM });
    this.mutableState.roomId = null;
    this.inputManager.stop();
    this.reconciler.clear();
    this.bodyState.clear();
    this.queries.cleanup();
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

  /**
   * Send a body descriptor to the server to create a new physics body.
   *
   * Pass `{ owned: true }` to mark this body as owned by the current client.
   * Owned bodies are automatically removed from the server when this client
   * disconnects. Bodies without ownership persist until explicitly removed.
   */
  addBody(body: BodyDescriptor, options?: { owned?: boolean }): void {
    if (!this.ws) return;
    if (options?.owned) {
      body.ownerId = this.mutableState.clientId ?? '__self__';
    }
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

  updateConstraint(constraintId: string, updates: ConstraintUpdates): void {
    if (!this.ws) return;
    this.send({ type: MessageType.UPDATE_CONSTRAINT, constraintId, updates });
  }

  // --- Callback registration ---

  onStateUpdate(callback: StateUpdateCallback): void { this.callbacks.onStateUpdate(callback); }
  onBodyAdded(callback: BodyAddedCallback): void { this.callbacks.onBodyAdded(callback); }
  onBodyRemoved(callback: BodyRemovedCallback): void { this.callbacks.onBodyRemoved(callback); }
  onSimulationStarted(callback: SimulationStartedCallback): void { this.callbacks.onSimulationStarted(callback); }
  onCollisionEvents(callback: CollisionEventsCallback): void { this.callbacks.onCollisionEvents(callback); }
  onConstraintAdded(callback: ConstraintAddedCallback): void { this.callbacks.onConstraintAdded(callback); }
  onConstraintRemoved(callback: ConstraintRemovedCallback): void { this.callbacks.onConstraintRemoved(callback); }
  onConstraintUpdated(callback: ConstraintUpdatedCallback): void { this.callbacks.onConstraintUpdated(callback); }
  onMeshBinary(callback: MeshBinaryCallback): void { this.callbacks.onMeshBinary(callback); }
  onGeometryDef(callback: GeometryDefCallback): void { this.callbacks.onGeometryDef(callback); }
  onMeshRef(callback: MeshRefCallback): void { this.callbacks.onMeshRef(callback); }
  onMaterialDef(callback: MaterialDefCallback): void { this.callbacks.onMaterialDef(callback); }
  onTextureDef(callback: TextureDefCallback): void { this.callbacks.onTextureDef(callback); }

  // --- Binary send methods ---

  /** Send pre-encoded binary mesh data directly over the WebSocket (no msgpackr wrapping). */
  sendMeshBinary(encoded: Uint8Array): void { this.sendRaw(encoded); }
  /** Send pre-encoded GEOMETRY_DEF directly over the WebSocket. */
  sendGeometryDef(encoded: Uint8Array): void { this.sendRaw(encoded); }
  /** Send pre-encoded MESH_REF directly over the WebSocket. */
  sendMeshRef(encoded: Uint8Array): void { this.sendRaw(encoded); }
  /** Send pre-encoded MATERIAL_DEF directly over the WebSocket. */
  sendMaterialDef(encoded: Uint8Array): void { this.sendRaw(encoded); }
  /** Send pre-encoded TEXTURE_DEF directly over the WebSocket. */
  sendTextureDef(encoded: Uint8Array): void { this.sendRaw(encoded); }

  // --- Shape queries ---

  shapeCastQuery(
    shape: ShapeDescriptor,
    startPosition: Vec3,
    endPosition: Vec3,
    rotation: Quat,
    ignoreBodyId?: string,
  ): Promise<ShapeCastResponse> {
    return this.queries.shapeCastQuery(shape, startPosition, endPosition, rotation, ignoreBodyId);
  }

  shapeProximityQuery(
    shape: ShapeDescriptor,
    position: Vec3,
    rotation: Quat,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<ShapeProximityResponse> {
    return this.queries.shapeProximityQuery(shape, position, rotation, maxDistance, ignoreBodyId);
  }

  pointProximityQuery(
    position: Vec3,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<PointProximityResponse> {
    return this.queries.pointProximityQuery(position, maxDistance, ignoreBodyId);
  }

  // --- Simulation control & getters ---

  startSimulation(): void {
    if (!this.ws) return;
    this.send({ type: MessageType.START_SIMULATION });
  }

  get simulationRunning(): boolean {
    return this.mutableState.simulationRunning;
  }

  /** Total number of bodies the client knows about (including sleeping/unchanged ones) */
  get totalBodyCount(): number {
    return this.bodyState.fullStateMap.size;
  }

  disconnect(): void {
    this.clockSync.stop();
    this.inputManager.stop();
    this.reconciler.clear();
    this.bodyState.clear();
    this.queries.cleanup();
    this.ws?.close();
    this.ws = null;
    this.mutableState.roomId = null;
    this.mutableState.clientId = null;
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
    return this.mutableState.clientId;
  }

  getRoomId(): string | null {
    return this.mutableState.roomId;
  }

  get bytesSent(): number {
    return this._bytesSent;
  }

  get bytesReceived(): number {
    return this._bytesReceived;
  }

  // --- Private ---

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const encoded = encodeMessage(message);
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }

  private sendRaw(encoded: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._bytesSent += encoded.byteLength;
      this.ws.send(encoded);
    }
  }
}
