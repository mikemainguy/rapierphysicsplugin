import type {
  BodyDescriptor,
  RoomSnapshot,
  InputAction,
  ClientMessage,
  ServerMessage,
  ClientInput,
} from '@havokserver/shared';
import {
  MessageType,
  encodeMessage,
  decodeServerMessage,
} from '@havokserver/shared';
import { ClockSyncClient } from './clock-sync.js';
import { StateReconciler } from './state-reconciler.js';
import { Interpolator } from './interpolator.js';
import { InputManager } from './input-manager.js';

type StateUpdateCallback = (state: RoomSnapshot) => void;
type BodyAddedCallback = (body: BodyDescriptor) => void;
type BodyRemovedCallback = (bodyId: string) => void;

export class PhysicsSyncClient {
  private ws: WebSocket | null = null;
  private clockSync: ClockSyncClient;
  private reconciler: StateReconciler;
  private inputManager: InputManager;
  private clientId: string | null = null;
  private roomId: string | null = null;

  private stateUpdateCallbacks: StateUpdateCallback[] = [];
  private bodyAddedCallbacks: BodyAddedCallback[] = [];
  private bodyRemovedCallbacks: BodyRemovedCallback[] = [];

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

      this.ws.onopen = () => {
        this.clockSync.start((data) => this.ws?.send(data));
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
      };

      this.ws.onmessage = (event) => {
        const message = decodeServerMessage(
          typeof event.data === 'string' ? event.data : event.data.toString()
        );
        this.handleMessage(message);
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

  onStateUpdate(callback: StateUpdateCallback): void {
    this.stateUpdateCallbacks.push(callback);
  }

  onBodyAdded(callback: BodyAddedCallback): void {
    this.bodyAddedCallbacks.push(callback);
  }

  onBodyRemoved(callback: BodyRemovedCallback): void {
    this.bodyRemovedCallbacks.push(callback);
  }

  disconnect(): void {
    this.clockSync.stop();
    this.inputManager.stop();
    this.reconciler.clear();
    this.ws?.close();
    this.ws = null;
    this.roomId = null;
    this.clientId = null;
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

        // Start input manager
        this.inputManager.start(
          (input) => this.sendClientInput(input),
          () => this.clockSync.getServerTick()
        );

        this.joinResolve?.(message.snapshot);
        this.joinResolve = null;
        break;

      case MessageType.ROOM_STATE: {
        const snapshot: RoomSnapshot = {
          tick: message.tick,
          timestamp: message.timestamp,
          bodies: message.bodies,
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
        for (const cb of this.bodyAddedCallbacks) {
          cb(message.body);
        }
        break;

      case MessageType.REMOVE_BODY:
        for (const cb of this.bodyRemovedCallbacks) {
          cb(message.bodyId);
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
      this.ws.send(encodeMessage(message));
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
}
