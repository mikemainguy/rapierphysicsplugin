import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Vector3,
  Quaternion,
  MeshBuilder,
  StandardMaterial,
  Color3,
  PhysicsMotionType,
  PhysicsShapeType,
  PhysicsBody,
  PhysicsShape,
  VertexData,
  Mesh,
} from '@babylonjs/core';
import type {
  PhysicsShapeParameters,
  PhysicsMaterial,
} from '@babylonjs/core';
import type { Scene, Nullable } from '@babylonjs/core';
import type {
  BodyDescriptor,
  ShapeDescriptor,
  BoxShapeParams,
  SphereShapeParams,
  CapsuleShapeParams,
  InputAction,
  CollisionEventData,
  RoomSnapshot,
  MotionType,
  MeshBinaryMessage,
  ComputeConfig,
} from '@rapierphysicsplugin/shared';
import { encodeMeshBinary } from '@rapierphysicsplugin/shared';
import { RapierPlugin } from './rapier-plugin.js';
import { PhysicsSyncClient } from './sync-client.js';

// Colors for different shape types (matches demo)
const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
};
const staticColor = new Color3(0.4, 0.4, 0.45);

export interface NetworkedRapierPluginConfig {
  serverUrl: string;
  roomId: string;
  compute?: ComputeConfig;
}

interface PendingBodyInfo {
  motionType: PhysicsMotionType;
  position: Vector3;
  orientation: Quaternion;
}

interface CachedShapeInfo {
  type: PhysicsShapeType;
  options: PhysicsShapeParameters;
}

export class NetworkedRapierPlugin extends RapierPlugin {
  private syncClient: PhysicsSyncClient;
  private scene: Scene | null = null;

  // Body ID tracking
  private bodyToId = new Map<PhysicsBody, string>();
  private idToBody = new Map<string, PhysicsBody>();

  // Pending body registration (between initBody and setShape)
  private pendingBodies = new Map<PhysicsBody, PendingBodyInfo>();

  // Shape params cache (stored in initShape, consumed in setShape)
  private shapeParamsCache = new Map<PhysicsShape, CachedShapeInfo>();

  // Pending descriptor sends (waiting for setMaterial or microtask fallback)
  private pendingDescriptors = new Map<PhysicsShape, {
    body: PhysicsBody;
    bodyId: string;
    pending: PendingBodyInfo;
    shapeInfo: CachedShapeInfo;
    shape: PhysicsShape;
    sent: boolean;
  }>();

  // Guard flags
  private remoteBodyCreationIds = new Set<string>();
  private remoteBodies = new Set<string>();

  // Collision event counter
  private collisionCount = 0;

  private config: NetworkedRapierPluginConfig;
  private simulationResetCallbacks: Array<() => void> = [];
  private stateUpdateCallbacks: Array<(state: RoomSnapshot) => void> = [];

  constructor(rapier: typeof RAPIER, gravity: Vector3, config: NetworkedRapierPluginConfig) {
    super(rapier, gravity);
    this.config = config;
    this.syncClient = new PhysicsSyncClient();
  }

  /**
   * Connect to the physics server and join the configured room.
   * Optionally pass the scene for remote body mesh creation.
   */
  async connect(scene?: Scene): Promise<RoomSnapshot> {
    if (scene) {
      this.scene = scene;
    }

    await this.syncClient.connect(this.config.serverUrl);
    const snapshot = await this.syncClient.joinRoom(this.config.roomId);

    // Wire up server callbacks
    this.syncClient.onBodyAdded((descriptor) => this.handleBodyAdded(descriptor));
    this.syncClient.onBodyRemoved((bodyId) => this.handleBodyRemoved(bodyId));
    this.syncClient.onMeshBinary((msg) => this.handleMeshBinaryReceived(msg));
    this.syncClient.onSimulationStarted((freshSnapshot) => this.handleSimulationStarted(freshSnapshot));
    this.syncClient.onCollisionEvents((events) => {
      this.collisionCount += events.length;
    });
    this.syncClient.onStateUpdate((state) => {
      for (const cb of this.stateUpdateCallbacks) cb(state);
    });

    return snapshot;
  }

  // --- Overrides ---

  initBody(body: PhysicsBody, motionType: PhysicsMotionType, position: Vector3, orientation: Quaternion): void {
    super.initBody(body, motionType, position, orientation);

    // Lazily detect scene from the first body's transform node
    if (!this.scene && body.transformNode) {
      this.scene = body.transformNode.getScene();
    }

    if (this.remoteBodyCreationIds.size === 0) {
      // Generate body ID from transform node name or random UUID
      const name = body.transformNode?.name;
      const id = name ?? crypto.randomUUID();
      this.bodyToId.set(body, id);
      this.idToBody.set(id, body);

      // Store pending info — we need the shape before we can send the descriptor
      this.pendingBodies.set(body, {
        motionType,
        position: position.clone(),
        orientation: orientation.clone(),
      });
    }
  }

  initShape(shape: PhysicsShape, type: PhysicsShapeType, options: PhysicsShapeParameters): void {
    super.initShape(shape, type, options);

    // Cache shape params for descriptor building in setShape
    this.shapeParamsCache.set(shape, { type, options });
  }

  setShape(body: PhysicsBody, shape: Nullable<PhysicsShape>): void {
    super.setShape(body, shape);

    if (this.remoteBodyCreationIds.size === 0 && shape) {
      const bodyId = this.bodyToId.get(body);
      const pending = this.pendingBodies.get(body);
      const shapeInfo = this.shapeParamsCache.get(shape);

      if (bodyId && pending && shapeInfo) {
        // Store pending descriptor — setMaterial will send it eagerly when
        // PhysicsAggregate sets material. Microtask fallback handles raw API usage.
        const record = { body, bodyId, pending, shapeInfo, shape, sent: false };
        this.pendingDescriptors.set(shape, record);
        this.pendingBodies.delete(body);

        queueMicrotask(() => {
          if (!record.sent) {
            record.sent = true;
            this.pendingDescriptors.delete(shape);
            const descriptor = this.buildDescriptor(body, bodyId, pending, shapeInfo, shape);
            if (descriptor) {
              this.syncClient.addBody(descriptor);
              this.sendMeshBinaryForBody(body, bodyId);
            }
          }
        });
      }
    }
  }

  setMaterial(shape: PhysicsShape, material: PhysicsMaterial): void {
    super.setMaterial(shape, material);

    const record = this.pendingDescriptors.get(shape);
    if (record && !record.sent) {
      record.sent = true;
      this.pendingDescriptors.delete(shape);
      const descriptor = this.buildDescriptor(record.body, record.bodyId, record.pending, record.shapeInfo, shape);
      if (descriptor) {
        this.syncClient.addBody(descriptor);
        this.sendMeshBinaryForBody(record.body, record.bodyId);
      }
    }
  }

  executeStep(delta: number, bodies: Array<PhysicsBody>): void {
    // Do NOT call super.executeStep() — skip local Rapier stepping entirely.
    // Instead, drain the event queue to prevent it from growing unbounded.
    this.eventQueue.drainCollisionEvents(() => {});
    this.eventQueue.drainContactForceEvents(() => {});

    const clockSync = this.syncClient.getClockSync();
    const reconciler = this.syncClient.getReconciler();
    const interpolator = reconciler.getInterpolator();
    const serverTime = clockSync.getServerTime();

    // Reset per-frame interpolation stats
    interpolator.resetStats();

    for (const body of bodies) {
      const bodyId = this.bodyToId.get(body);
      if (!bodyId) continue;

      const interpolated = reconciler.getInterpolatedRemoteState(bodyId, serverTime);
      if (interpolated) {
        // Update BabylonJS transform node
        const tn = body.transformNode;
        if (tn) {
          tn.position.set(interpolated.position.x, interpolated.position.y, interpolated.position.z);
          if (!tn.rotationQuaternion) {
            tn.rotationQuaternion = new Quaternion();
          }
          tn.rotationQuaternion.set(
            interpolated.rotation.x,
            interpolated.rotation.y,
            interpolated.rotation.z,
            interpolated.rotation.w,
          );
        }

        // Also update the Rapier rigid body for query consistency
        const rb = this.bodyToRigidBody.get(body);
        if (rb) {
          rb.setTranslation(
            new this.rapier.Vector3(interpolated.position.x, interpolated.position.y, interpolated.position.z),
            false,
          );
          rb.setRotation(
            new this.rapier.Quaternion(
              interpolated.rotation.x,
              interpolated.rotation.y,
              interpolated.rotation.z,
              interpolated.rotation.w,
            ),
            false,
          );
        }
      }
      // If null (e.g. static body with no updates), mesh keeps its initial position
    }
  }

  sync(body: PhysicsBody): void {
    // If this is a networked body, executeStep already wrote transforms — no-op
    if (this.bodyToId.has(body)) return;

    // Otherwise fall through to default Rapier sync for non-networked bodies
    super.sync(body);
  }

  removeBody(body: PhysicsBody): void {
    const bodyId = this.bodyToId.get(body);
    if (bodyId) {
      // Only tell the server to remove if this is a locally-owned body
      if (!this.remoteBodies.has(bodyId)) {
        this.syncClient.removeBody(bodyId);
      }
      this.bodyToId.delete(body);
      this.idToBody.delete(bodyId);
      this.remoteBodies.delete(bodyId);
      this.pendingBodies.delete(body);
    }
    super.removeBody(body);
  }

  // --- Server callback handlers ---

  private handleBodyAdded(descriptor: BodyDescriptor): void {
    // Skip if we already know about this body
    if (this.idToBody.has(descriptor.id)) return;

    if (!this.scene) return;

    // Always take the synchronous path — mesh geometry arrives separately via binary channel
    this.createRemoteBody(descriptor, this.createMeshFromDescriptor(descriptor));
  }

  private createRemoteBody(descriptor: BodyDescriptor, mesh: Mesh): void {
    const scene = this.scene!;

    // Store metadata for click handlers etc.
    mesh.metadata = { bodyId: descriptor.id };

    const motionType = this.motionTypeFromWire(descriptor.motionType);

    // Create a PhysicsBody wrapper if the scene has physics enabled
    const physicsEngine = scene.getPhysicsEngine();
    if (physicsEngine) {
      this.remoteBodyCreationIds.add(descriptor.id);
      try {
        const body = new PhysicsBody(mesh, motionType, false, scene);

        // Create shape from descriptor
        const shape = this.createShapeFromDescriptor(descriptor, mesh);
        if (shape) {
          body.shape = shape;
        }

        // Track this as a remote body
        this.bodyToId.set(body, descriptor.id);
        this.idToBody.set(descriptor.id, body);
        this.remoteBodies.add(descriptor.id);
      } finally {
        this.remoteBodyCreationIds.delete(descriptor.id);
      }
    }
  }

  private handleBodyRemoved(bodyId: string): void {
    const body = this.idToBody.get(bodyId);
    if (body) {
      // Dispose the mesh
      const tn = body.transformNode;
      if (tn) {
        tn.dispose();
      }
      body.dispose();

      this.bodyToId.delete(body);
      this.idToBody.delete(bodyId);
      this.remoteBodies.delete(bodyId);
    }
  }

  private handleSimulationStarted(freshSnapshot: RoomSnapshot): void {
    // Snapshot entries before clearing to avoid concurrent modification
    const entries = Array.from(this.bodyToId.entries());
    this.bodyToId.clear();
    this.idToBody.clear();
    this.pendingBodies.clear();
    this.remoteBodies.clear();
    this.collisionCount = 0;

    // Dispose all existing physics bodies and their meshes
    for (const [body] of entries) {
      const tn = body.transformNode;
      if (tn) {
        tn.dispose();
      }
      // Call super.removeBody to clean up Rapier state without notifying server
      super.removeBody(body);
    }

    // Notify user callbacks so they can re-create local bodies (e.g. ground plane)
    for (const cb of this.simulationResetCallbacks) cb();

    // Bodies from the fresh snapshot will arrive via onBodyAdded callbacks
  }

  // --- Descriptor building ---

  private buildDescriptor(
    body: PhysicsBody,
    bodyId: string,
    pending: PendingBodyInfo,
    shapeInfo: CachedShapeInfo,
    shape: PhysicsShape,
  ): BodyDescriptor | null {
    const motionType = this.motionTypeToWire(pending.motionType);
    const shapeDescriptor = this.shapeInfoToDescriptor(shapeInfo);
    if (!shapeDescriptor) return null;

    // Get material properties
    const material: PhysicsMaterial = this.getMaterial(shape);

    // Get mass from the Rapier rigid body
    const rb = this.bodyToRigidBody.get(body);
    const mass = rb ? rb.mass() : undefined;

    return {
      id: bodyId,
      shape: shapeDescriptor,
      motionType,
      position: { x: pending.position.x, y: pending.position.y, z: pending.position.z },
      rotation: { x: pending.orientation.x, y: pending.orientation.y, z: pending.orientation.z, w: pending.orientation.w },
      mass,
      friction: material.friction,
      restitution: material.restitution,
    };
  }

  private shapeInfoToDescriptor(shapeInfo: CachedShapeInfo): ShapeDescriptor | null {
    const { type, options } = shapeInfo;

    switch (type) {
      case PhysicsShapeType.BOX: {
        const ext = options.extents ?? new Vector3(1, 1, 1);
        return {
          type: 'box',
          params: { halfExtents: { x: ext.x / 2, y: ext.y / 2, z: ext.z / 2 } },
        };
      }
      case PhysicsShapeType.SPHERE: {
        const r = options.radius ?? 0.5;
        return { type: 'sphere', params: { radius: r } };
      }
      case PhysicsShapeType.CAPSULE: {
        const pointA = options.pointA ?? new Vector3(0, 0, 0);
        const pointB = options.pointB ?? new Vector3(0, 1, 0);
        const halfHeight = Vector3.Distance(pointA, pointB) / 2;
        const radius = options.radius ?? 0.5;
        return { type: 'capsule', params: { halfHeight, radius } };
      }
      case PhysicsShapeType.MESH: {
        const mesh = options.mesh;
        if (mesh) {
          const positions = mesh.getVerticesData('position');
          const indices = mesh.getIndices();
          if (positions && indices) {
            return {
              type: 'mesh',
              params: { vertices: new Float32Array(positions), indices: new Uint32Array(indices) },
            };
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  // --- Binary mesh send/receive ---

  private sendMeshBinaryForBody(body: PhysicsBody, bodyId: string): void {
    const tn = body.transformNode;
    if (!tn || !('geometry' in tn)) return;

    const mesh = tn as Mesh;
    const positionsRaw = mesh.getVerticesData('position');
    const indicesRaw = mesh.getIndices();
    if (!positionsRaw || !indicesRaw) return;

    const positions = new Float32Array(positionsRaw);
    const indices = new Uint32Array(indicesRaw);

    const normalsRaw = mesh.getVerticesData('normal');
    const normals = normalsRaw ? new Float32Array(normalsRaw) : undefined;

    const uvsRaw = mesh.getVerticesData('uv');
    const uvs = uvsRaw ? new Float32Array(uvsRaw) : undefined;

    const colorsRaw = mesh.getVerticesData('color');
    const colors = colorsRaw ? new Float32Array(colorsRaw) : undefined;

    let diffuseColor: { r: number; g: number; b: number } | undefined;
    let specularColor: { r: number; g: number; b: number } | undefined;
    const mat = mesh.material as StandardMaterial | null;
    if (mat) {
      diffuseColor = { r: mat.diffuseColor.r, g: mat.diffuseColor.g, b: mat.diffuseColor.b };
      specularColor = { r: mat.specularColor.r, g: mat.specularColor.g, b: mat.specularColor.b };
    }

    const encoded = encodeMeshBinary(bodyId, positions, normals, uvs, colors, indices, diffuseColor, specularColor);
    this.syncClient.sendMeshBinary(encoded);
  }

  private handleMeshBinaryReceived(msg: MeshBinaryMessage): void {
    const body = this.idToBody.get(msg.bodyId);
    if (!body) return;

    const scene = this.scene;
    if (!scene) return;

    const tn = body.transformNode;
    if (!tn) return;

    const mesh = tn as Mesh;

    // Apply new vertex data in-place (replaces geometry without swapping the mesh,
    // which would break the physics body's internal transform node binding).
    const vertexData = new VertexData();
    vertexData.positions = msg.positions;
    if (msg.normals) vertexData.normals = msg.normals;
    if (msg.uvs) vertexData.uvs = msg.uvs;
    if (msg.colors) vertexData.colors = msg.colors;
    vertexData.indices = msg.indices;
    vertexData.applyToMesh(mesh);

    // Update material colors
    const oldMat = mesh.material;
    if (oldMat) oldMat.dispose();
    const mat = new StandardMaterial(`${msg.bodyId}Mat_bin`, scene);
    if (msg.diffuseColor) {
      mat.diffuseColor = new Color3(msg.diffuseColor.r, msg.diffuseColor.g, msg.diffuseColor.b);
    }
    if (msg.specularColor) {
      mat.specularColor = new Color3(msg.specularColor.r, msg.specularColor.g, msg.specularColor.b);
    }
    mesh.material = mat;
  }

  // --- Mesh creation for remote bodies ---

  private createMeshFromDescriptor(descriptor: BodyDescriptor): Mesh {
    const scene = this.scene!;
    let mesh: Mesh;
    let colorKey: string;

    switch (descriptor.shape.type) {
      case 'box': {
        const p = descriptor.shape.params as BoxShapeParams;
        mesh = MeshBuilder.CreateBox(descriptor.id, {
          width: p.halfExtents.x * 2,
          height: p.halfExtents.y * 2,
          depth: p.halfExtents.z * 2,
        }, scene);
        colorKey = 'box';
        break;
      }
      case 'sphere': {
        const p = descriptor.shape.params as SphereShapeParams;
        mesh = MeshBuilder.CreateSphere(descriptor.id, { diameter: p.radius * 2 }, scene);
        colorKey = 'sphere';
        break;
      }
      case 'capsule': {
        const p = descriptor.shape.params as CapsuleShapeParams;
        mesh = MeshBuilder.CreateCapsule(descriptor.id, {
          height: p.halfHeight * 2 + p.radius * 2,
          radius: p.radius,
        }, scene);
        colorKey = 'capsule';
        break;
      }
      default:
        mesh = MeshBuilder.CreateBox(descriptor.id, { size: 1 }, scene);
        colorKey = 'box';
    }

    mesh.position.set(descriptor.position.x, descriptor.position.y, descriptor.position.z);
    mesh.rotationQuaternion = new Quaternion(
      descriptor.rotation.x,
      descriptor.rotation.y,
      descriptor.rotation.z,
      descriptor.rotation.w,
    );

    const mat = new StandardMaterial(`${descriptor.id}Mat`, scene);
    if (descriptor.motionType === 'static') {
      mat.diffuseColor = staticColor;
    } else {
      mat.diffuseColor = shapeColors[colorKey] ?? new Color3(0.5, 0.5, 0.5);
    }
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    mesh.material = mat;

    return mesh;
  }

  private createShapeFromDescriptor(
    descriptor: BodyDescriptor,
    mesh: Mesh,
  ): PhysicsShape | null {
    const scene = this.scene!;

    switch (descriptor.shape.type) {
      case 'box': {
        const p = descriptor.shape.params as BoxShapeParams;
        return new PhysicsShape(
          { type: PhysicsShapeType.BOX, parameters: { extents: new Vector3(p.halfExtents.x * 2, p.halfExtents.y * 2, p.halfExtents.z * 2) } },
          scene,
        );
      }
      case 'sphere': {
        const p = descriptor.shape.params as SphereShapeParams;
        return new PhysicsShape(
          { type: PhysicsShapeType.SPHERE, parameters: { radius: p.radius } },
          scene,
        );
      }
      case 'capsule': {
        const p = descriptor.shape.params as CapsuleShapeParams;
        return new PhysicsShape(
          {
            type: PhysicsShapeType.CAPSULE,
            parameters: {
              pointA: new Vector3(0, -p.halfHeight, 0),
              pointB: new Vector3(0, p.halfHeight, 0),
              radius: p.radius,
            },
          },
          scene,
        );
      }
      case 'mesh': {
        return new PhysicsShape(
          { type: PhysicsShapeType.MESH, parameters: { mesh } },
          scene,
        );
      }
      default:
        return null;
    }
  }

  // --- Motion type conversion helpers ---

  private motionTypeToWire(motionType: PhysicsMotionType): MotionType {
    switch (motionType) {
      case PhysicsMotionType.DYNAMIC: return 'dynamic';
      case PhysicsMotionType.STATIC: return 'static';
      case PhysicsMotionType.ANIMATED: return 'kinematic';
      default: return 'dynamic';
    }
  }

  private motionTypeFromWire(motionType: MotionType): PhysicsMotionType {
    switch (motionType) {
      case 'dynamic': return PhysicsMotionType.DYNAMIC;
      case 'static': return PhysicsMotionType.STATIC;
      case 'kinematic': return PhysicsMotionType.ANIMATED;
      default: return PhysicsMotionType.DYNAMIC;
    }
  }

  // --- Proxy methods for sync client functionality ---

  startSimulation(): void {
    this.syncClient.startSimulation();
  }

  sendInput(actions: InputAction[]): void {
    this.syncClient.sendInput(actions);
  }

  onCollisionEvents(callback: (events: CollisionEventData[]) => void): void {
    this.syncClient.onCollisionEvents(callback);
  }

  onSimulationReset(callback: () => void): void {
    this.simulationResetCallbacks.push(callback);
  }

  onStateUpdate(callback: (state: RoomSnapshot) => void): void {
    this.stateUpdateCallbacks.push(callback);
  }

  getSyncClient(): PhysicsSyncClient {
    return this.syncClient;
  }

  getClientId(): string | null {
    return this.syncClient.getClientId();
  }

  get simulationRunning(): boolean {
    return this.syncClient.simulationRunning;
  }

  get totalBodyCount(): number {
    return this.syncClient.totalBodyCount;
  }

  get bytesSent(): number {
    return this.syncClient.bytesSent;
  }

  get bytesReceived(): number {
    return this.syncClient.bytesReceived;
  }

  get collisionEventCount(): number {
    return this.collisionCount;
  }

  /** Access the underlying reconciler for debug stats */
  getReconciler() {
    return this.syncClient.getReconciler();
  }

  /** Access the clock sync for debug stats */
  getClockSync() {
    return this.syncClient.getClockSync();
  }
}
