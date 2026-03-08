import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  BodyDescriptor,
  CollisionEventData,
  ConstraintDescriptor,
  RoomSnapshot,
  Vec3,
  ShapeCastRequest,
  ShapeProximityRequest,
  PointProximityRequest,
} from '@rapierphysicsplugin/shared';
import {
  BROADCAST_INTERVAL,
  MessageType,
  encodeMessage,
  encodeRoomState,
  readBodyIdFromMeshBinary,
  readHashFromGeometryDef,
  readBodyIdFromMeshRef,
  readGeometryHashFromMeshRef,
  readMaterialHashFromMeshRef,
  readHashFromTextureDef,
  readHashFromMaterialDef,
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
  private initialConstraints: ConstraintDescriptor[] = [];
  private activeConstraints: Map<string, ConstraintDescriptor> = new Map();
  private activeBodies: Map<string, BodyDescriptor> = new Map();
  private meshBinaryStore: Map<string, Uint8Array> = new Map();
  private geometryStore: Map<string, Uint8Array> = new Map();
  private meshRefStore: Map<string, Uint8Array> = new Map();
  private geometryRefCount: Map<string, Set<string>> = new Map();
  private materialStore: Map<string, Uint8Array> = new Map();
  private textureStore: Map<string, Uint8Array> = new Map();
  private materialRefCount: Map<string, Set<string>> = new Map();
  private currentTick = 0;
  private ticksSinceLastBroadcast = 0;
  private pendingCollisionEvents: CollisionEventData[] = [];

  constructor(id: string, rapier: typeof RAPIER, gravity?: Vec3) {
    this.id = id;
    this.physicsWorld = new PhysicsWorld(rapier, gravity);
    this.simulationLoop = new SimulationLoop(this);
    this.stateManager = new StateManager();
  }

  loadInitialState(bodies: BodyDescriptor[], constraints?: ConstraintDescriptor[]): void {
    this.initialBodies = bodies;
    this.initialConstraints = constraints ?? [];
    this.physicsWorld.loadState(bodies);
    for (const b of bodies) {
      this.activeBodies.set(b.id, b);
    }
    for (const c of this.initialConstraints) {
      this.physicsWorld.addConstraint(c);
      this.activeConstraints.set(c.id, c);
    }
  }

  addClient(conn: ClientConnection): void {
    this.clients.set(conn.id, conn);
    this.inputBuffers.set(conn.id, new InputBuffer());
    conn.roomId = this.id;

    // Send full state snapshot to the joining client, including body ID mapping and constraints
    const snapshot = this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
    const constraints = Array.from(this.activeConstraints.values());
    const bodies = Array.from(this.activeBodies.values());
    conn.send(encodeMessage({
      type: MessageType.ROOM_JOINED,
      roomId: this.id,
      snapshot,
      clientId: conn.id,
      simulationRunning: this.simulationLoop.isRunning,
      bodyIdMap: this.stateManager.getIdToIndexRecord(),
      constraints: constraints.length > 0 ? constraints : undefined,
      bodies: bodies.length > 0 ? bodies : undefined,
    }));

    // Send stored mesh binaries to the late joiner
    for (const [, meshData] of this.meshBinaryStore) {
      conn.send(meshData);
    }

    // Late-joiner replay order: textures → materials → geometry defs → mesh refs
    for (const [, texData] of this.textureStore) {
      conn.send(texData);
    }
    for (const [, matData] of this.materialStore) {
      conn.send(matData);
    }
    for (const [, geomData] of this.geometryStore) {
      conn.send(geomData);
    }
    for (const [, refData] of this.meshRefStore) {
      conn.send(refData);
    }
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
    if (this.physicsWorld.hasBody(descriptor.id)) {
      return descriptor.id; // already exists, no-op
    }
    const id = this.physicsWorld.addBody(descriptor);
    const bodyIndex = this.stateManager.ensureBodyIndex(id);
    // Store descriptor without meshData (mesh geometry arrives via binary channel)
    const stored = { ...descriptor };
    delete (stored as Record<string, unknown>).meshData;
    this.activeBodies.set(id, stored);

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
    this.activeBodies.delete(bodyId);
    this.meshBinaryStore.delete(bodyId);

    // Clean up geometry + material registry refs (keep defs for reuse)
    const refData = this.meshRefStore.get(bodyId);
    if (refData) {
      const geoHash = readGeometryHashFromMeshRef(refData);
      const geoRefs = this.geometryRefCount.get(geoHash);
      if (geoRefs) {
        geoRefs.delete(bodyId);
      }

      const matHash = readMaterialHashFromMeshRef(refData);
      const matRefs = this.materialRefCount.get(matHash);
      if (matRefs) {
        matRefs.delete(bodyId);
      }

      this.meshRefStore.delete(bodyId);
    }

    // Notify all clients
    this.broadcast(encodeMessage({
      type: MessageType.REMOVE_BODY,
      bodyId,
    }));
  }

  addConstraint(descriptor: ConstraintDescriptor): string {
    if (this.activeConstraints.has(descriptor.id)) {
      return descriptor.id; // already exists, no-op
    }
    const id = this.physicsWorld.addConstraint(descriptor);
    this.activeConstraints.set(id, descriptor);

    // Broadcast to all clients
    this.broadcast(encodeMessage({
      type: MessageType.ADD_CONSTRAINT,
      constraint: descriptor,
    }));

    return id;
  }

  removeConstraint(constraintId: string): void {
    this.physicsWorld.removeConstraint(constraintId);
    this.activeConstraints.delete(constraintId);

    // Broadcast to all clients
    this.broadcast(encodeMessage({
      type: MessageType.REMOVE_CONSTRAINT,
      constraintId,
    }));
  }

  relayMeshBinary(senderId: string, data: Uint8Array): void {
    // Extract bodyId from the header to store for late joiners
    const bodyId = readBodyIdFromMeshBinary(data);
    // Store a copy for late joiners
    this.meshBinaryStore.set(bodyId, new Uint8Array(data));

    // Broadcast raw bytes to all clients except sender
    for (const [clientId, client] of this.clients) {
      if (clientId !== senderId) {
        client.send(data);
      }
    }
  }

  relayTextureDef(senderId: string, data: Uint8Array): void {
    const hash = readHashFromTextureDef(data);

    // Store if new
    if (!this.textureStore.has(hash)) {
      this.textureStore.set(hash, new Uint8Array(data));
    }

    // Relay to all clients except sender
    for (const [clientId, client] of this.clients) {
      if (clientId !== senderId) {
        client.send(data);
      }
    }
  }

  relayMaterialDef(senderId: string, data: Uint8Array): void {
    const hash = readHashFromMaterialDef(data);

    // Store if new
    if (!this.materialStore.has(hash)) {
      this.materialStore.set(hash, new Uint8Array(data));
    }

    // Relay to all clients except sender
    for (const [clientId, client] of this.clients) {
      if (clientId !== senderId) {
        client.send(data);
      }
    }
  }

  relayGeometryDef(senderId: string, data: Uint8Array): void {
    const hash = readHashFromGeometryDef(data);

    // Store if new (skip if already stored — another client already sent this geometry)
    if (!this.geometryStore.has(hash)) {
      this.geometryStore.set(hash, new Uint8Array(data));
    }

    // Relay to all clients except sender
    for (const [clientId, client] of this.clients) {
      if (clientId !== senderId) {
        client.send(data);
      }
    }
  }

  relayMeshRef(senderId: string, data: Uint8Array): void {
    const bodyId = readBodyIdFromMeshRef(data);
    const geoHash = readGeometryHashFromMeshRef(data);
    const matHash = readMaterialHashFromMeshRef(data);

    // Always store + relay
    this.meshRefStore.set(bodyId, new Uint8Array(data));

    // Track geometry ref count
    let geoRefs = this.geometryRefCount.get(geoHash);
    if (!geoRefs) {
      geoRefs = new Set();
      this.geometryRefCount.set(geoHash, geoRefs);
    }
    geoRefs.add(bodyId);

    // Track material ref count
    let matRefs = this.materialRefCount.get(matHash);
    if (!matRefs) {
      matRefs = new Set();
      this.materialRefCount.set(matHash, matRefs);
    }
    matRefs.add(bodyId);

    // Relay to all clients except sender
    for (const [clientId, client] of this.clients) {
      if (clientId !== senderId) {
        client.send(data);
      }
    }
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

  handleShapeCastQuery(conn: ClientConnection, request: ShapeCastRequest): void {
    const response = this.physicsWorld.shapeCast(request);
    conn.send(encodeMessage({
      type: MessageType.SHAPE_CAST_RESPONSE,
      response,
    }));
  }

  handleShapeProximityQuery(conn: ClientConnection, request: ShapeProximityRequest): void {
    const response = this.physicsWorld.shapeProximity(request);
    conn.send(encodeMessage({
      type: MessageType.SHAPE_PROXIMITY_RESPONSE,
      response,
    }));
  }

  handlePointProximityQuery(conn: ClientConnection, request: PointProximityRequest): void {
    const response = this.physicsWorld.pointProximity(request);
    conn.send(encodeMessage({
      type: MessageType.POINT_PROXIMITY_RESPONSE,
      response,
    }));
  }

  getSnapshot(): RoomSnapshot {
    return this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
  }

  startSimulation(): void {
    // If already running, stop and reset
    if (this.simulationLoop.isRunning) {
      this.simulationLoop.stop();
    }

    // Reset physics world to initial state (including constraints)
    this.physicsWorld.reset(this.initialBodies, this.initialConstraints);
    this.currentTick = 0;
    this.ticksSinceLastBroadcast = 0;
    this.pendingCollisionEvents = [];
    this.meshBinaryStore.clear();
    this.geometryStore.clear();
    this.meshRefStore.clear();
    this.geometryRefCount.clear();
    this.materialStore.clear();
    this.textureStore.clear();
    this.materialRefCount.clear();
    this.stateManager.clear();
    for (const [, buffer] of this.inputBuffers) {
      buffer.clear();
    }

    // Reset active constraints and bodies to initial set
    this.activeConstraints.clear();
    for (const c of this.initialConstraints) {
      this.activeConstraints.set(c.id, c);
    }
    this.activeBodies.clear();
    for (const b of this.initialBodies) {
      this.activeBodies.set(b.id, b);
    }

    // Start simulation loop
    this.simulationLoop.start();

    // Broadcast fresh snapshot to all clients (includes updated body ID mapping, constraints, and bodies)
    const snapshot = this.stateManager.createSnapshot(this.physicsWorld, this.currentTick);
    const constraints = Array.from(this.activeConstraints.values());
    const bodies = Array.from(this.activeBodies.values());
    this.broadcast(encodeMessage({
      type: MessageType.SIMULATION_STARTED,
      snapshot,
      bodyIdMap: this.stateManager.getIdToIndexRecord(),
      constraints: constraints.length > 0 ? constraints : undefined,
      bodies: bodies.length > 0 ? bodies : undefined,
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
    this.activeConstraints.clear();
    this.activeBodies.clear();
    this.meshBinaryStore.clear();
    this.geometryStore.clear();
    this.meshRefStore.clear();
    this.geometryRefCount.clear();
    this.materialStore.clear();
    this.textureStore.clear();
    this.materialRefCount.clear();
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

  createRoom(roomId: string, initialBodies: BodyDescriptor[] = [], gravity?: Vec3, initialConstraints?: ConstraintDescriptor[]): Room {
    if (this.rooms.has(roomId)) {
      throw new Error(`Room "${roomId}" already exists`);
    }

    const room = new Room(roomId, this.rapier, gravity);
    if (initialBodies.length > 0 || (initialConstraints && initialConstraints.length > 0)) {
      room.loadInitialState(initialBodies, initialConstraints);
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
