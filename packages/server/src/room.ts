import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  CollisionEventData,
  RoomSnapshot,
  Vec3,
} from '@rapierphysicsplugin/shared';
import {
  BROADCAST_INTERVAL,
  MessageType,
  encodeMessage,
  encodeRoomState,
} from '@rapierphysicsplugin/shared';
import { PhysicsWorld } from './physics-world.js';
import { SimulationLoop } from './simulation-loop.js';
import { StateManager } from './state-manager.js';
import { InputBuffer } from './input-buffer.js';
import type { ClientConnection } from './client-connection.js';

export class Room {
  readonly id: string;
  readonly physicsWorld: PhysicsWorld;
  private simulationLoop: SimulationLoop;
  private stateManager: StateManager;
  private clients: Map<string, ClientConnection> = new Map();
  private inputBuffers: Map<string, InputBuffer> = new Map();
  private initialBodies: BodyDescriptor[] = [];
  private currentTick = 0;
  private ticksSinceLastBroadcast = 0;
  private pendingCollisionEvents: CollisionEventData[] = [];

  constructor(id: string, rapier: typeof RAPIER, gravity?: Vec3) {
    this.id = id;
    this.physicsWorld = new PhysicsWorld(rapier, gravity);
    this.simulationLoop = new SimulationLoop(this);
    this.stateManager = new StateManager();
  }

  loadInitialState(bodies: BodyDescriptor[]): void {
    this.initialBodies = bodies;
    this.physicsWorld.loadState(bodies);
  }

  addClient(conn: ClientConnection): void {
    this.clients.set(conn.id, conn);
    this.inputBuffers.set(conn.id, new InputBuffer());
    conn.roomId = this.id;

    // Send full state snapshot to the joining client, including body ID mapping
    const snapshot = this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
    conn.send(encodeMessage({
      type: MessageType.ROOM_JOINED,
      roomId: this.id,
      snapshot,
      clientId: conn.id,
      simulationRunning: this.simulationLoop.isRunning,
      bodyIdMap: this.stateManager.getIdToIndexRecord(),
    }));
  }

  removeClient(conn: ClientConnection): void {
    this.clients.delete(conn.id);
    this.inputBuffers.delete(conn.id);
    conn.roomId = null;

    // Stop simulation if no clients remain
    if (this.clients.size === 0) {
      this.simulationLoop.stop();
    }
  }

  addBody(descriptor: BodyDescriptor): string {
    const id = this.physicsWorld.addBody(descriptor);
    const bodyIndex = this.stateManager.ensureBodyIndex(id);

    // Notify all clients (include the numeric index for the new body)
    this.broadcast(encodeMessage({
      type: MessageType.ADD_BODY,
      body: descriptor,
      bodyIndex,
    }));

    return id;
  }

  removeBody(bodyId: string): void {
    this.physicsWorld.removeBody(bodyId);
    this.stateManager.removeBody(bodyId);

    // Notify all clients
    this.broadcast(encodeMessage({
      type: MessageType.REMOVE_BODY,
      bodyId,
    }));
  }

  bufferInput(clientId: string, input: import('@rapierphysicsplugin/shared').ClientInput): void {
    const buffer = this.inputBuffers.get(clientId);
    if (buffer) {
      // Map client tick to the current server tick (best-effort for now)
      buffer.addInput(input, this.currentTick);
    }
  }

  tick(): void {
    // 1. Process buffered inputs for this tick
    for (const [, buffer] of this.inputBuffers) {
      const inputs = buffer.getInputsForTick(this.currentTick);
      for (const input of inputs) {
        for (const action of input.actions) {
          this.physicsWorld.applyInput(action);
        }
      }
    }

    // 2. Step the physics world and collect collision events
    const collisionEvents = this.physicsWorld.step();
    if (collisionEvents.length > 0) {
      this.pendingCollisionEvents.push(...collisionEvents);
    }

    // 3. Increment tick
    this.currentTick++;
    this.ticksSinceLastBroadcast++;

    // 4. Broadcast state at the configured interval
    if (this.ticksSinceLastBroadcast >= BROADCAST_INTERVAL) {
      this.broadcastState();
      this.ticksSinceLastBroadcast = 0;
    }
  }

  private broadcastState(): void {
    const delta = this.stateManager.createDelta(this.physicsWorld, this.currentTick);

    if (delta.bodies.length > 0) {
      // Encode directly with ID mapping for numeric body indices
      const message = encodeRoomState(
        {
          type: MessageType.ROOM_STATE,
          tick: delta.tick,
          timestamp: delta.timestamp,
          bodies: delta.bodies,
          isDelta: true,
        },
        this.stateManager.getIdToIndexMap(),
      );

      this.broadcast(message);
    }

    if (this.pendingCollisionEvents.length > 0) {
      const collisionMessage = encodeMessage({
        type: MessageType.COLLISION_EVENTS,
        tick: this.currentTick,
        events: this.pendingCollisionEvents,
      });
      this.broadcast(collisionMessage);
      this.pendingCollisionEvents = [];
    }
  }

  private broadcast(message: Uint8Array): void {
    for (const [, client] of this.clients) {
      client.send(message);
    }
  }

  getSnapshot(): RoomSnapshot {
    return this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
  }

  startSimulation(): void {
    // If already running, stop and reset
    if (this.simulationLoop.isRunning) {
      this.simulationLoop.stop();
    }

    // Reset physics world to initial state
    this.physicsWorld.reset(this.initialBodies);
    this.currentTick = 0;
    this.ticksSinceLastBroadcast = 0;
    this.pendingCollisionEvents = [];
    this.stateManager.clear();
    for (const [, buffer] of this.inputBuffers) {
      buffer.clear();
    }

    // Start simulation loop
    this.simulationLoop.start();

    // Broadcast fresh snapshot to all clients (includes updated body ID mapping)
    const snapshot = this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
    this.broadcast(encodeMessage({
      type: MessageType.SIMULATION_STARTED,
      snapshot,
      bodyIdMap: this.stateManager.getIdToIndexRecord(),
    }));
  }

  get isSimulationRunning(): boolean {
    return this.simulationLoop.isRunning;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get tickNumber(): number {
    return this.currentTick;
  }

  destroy(): void {
    this.simulationLoop.stop();
    for (const [, client] of this.clients) {
      client.roomId = null;
    }
    this.clients.clear();
    this.inputBuffers.clear();
    this.pendingCollisionEvents = [];
    this.stateManager.clear();
    this.physicsWorld.destroy();
  }
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private rapier: typeof RAPIER;

  constructor(rapier: typeof RAPIER) {
    this.rapier = rapier;
  }

  createRoom(roomId: string, initialBodies: BodyDescriptor[] = [], gravity?: Vec3): Room {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room "${roomId}" already exists`);
    }

    const room = new Room(roomId, this.rapier, gravity);
    if (initialBodies.length > 0) {
      room.loadInitialState(initialBodies);
    }
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  destroyRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }
}
