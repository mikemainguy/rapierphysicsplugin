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
  Texture,
} from '@babylonjs/core';
import type {
  PhysicsShapeParameters,
  PhysicsMaterial,
  PhysicsMassProperties,
  PhysicsConstraint,
  PhysicsConstraintAxisLimitMode,
  PhysicsConstraintMotorType,
  PhysicsConstraintAxis,
} from '@babylonjs/core';
import type { Scene, Nullable, BaseTexture } from '@babylonjs/core';
import type {
  BodyDescriptor,
  ShapeDescriptor,
  BoxShapeParams,
  SphereShapeParams,
  CapsuleShapeParams,
  InputAction,
  CollisionEventData,
  ConstraintDescriptor,
  ConstraintUpdates,
  RoomSnapshot,
  MotionType,
  MeshBinaryMessage,
  ComputeConfig,
  Vec3,
  Quat,
  ShapeCastResponse,
  ShapeProximityResponse,
  PointProximityResponse,
} from '@rapierphysicsplugin/shared';
import {
  createJointData,
  encodeMeshBinary,
  computeGeometryHash,
  encodeGeometryDef,
  encodeMeshRef,
  computeMaterialHash,
  computeTextureHash,
  encodeMaterialDef,
  encodeTextureDef,
} from '@rapierphysicsplugin/shared';
import type { GeometryDefData, MeshRefData, MaterialDefData, TextureDefData } from '@rapierphysicsplugin/shared';
import { RapierPlugin } from './rapier-plugin.js';
import { PhysicsSyncClient } from './sync-client.js';
import { buildConstraintDescriptor } from './rapier-constraint-ops.js';

// Colors for different shape types (matches demo)
const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
};
const staticColor = new Color3(0.4, 0.4, 0.45);

export interface NetworkedRapierPluginConfig {
  /** WebSocket URL of the physics server (e.g. `"wss://example.com"`). */
  serverUrl: string;

  /** Room identifier to join on the server. */
  roomId: string;

  /** WASM backend selection (compat vs SIMD). */
  compute?: ComputeConfig;

  /**
   * How far behind real-time the renderer draws, in milliseconds.
   *
   * A higher value gives the interpolation buffer more headroom to absorb
   * network jitter, producing smoother motion at the cost of additional
   * visual latency. A lower value reduces latency but increases the chance
   * of extrapolation (which can cause small position/rotation jumps).
   *
   * @default `4 * (1000 / BROADCAST_RATE)` — ~133 ms at 30 Hz broadcast
   */
  renderDelayMs?: number;

  /**
   * Maximum number of state snapshots kept per body in the interpolation buffer.
   *
   * More snapshots provide a wider window for interpolation, which helps on
   * unstable connections. Fewer snapshots reduce memory usage. The interpolator
   * always needs at least **two** snapshots to interpolate; any excess is kept
   * as look-back history.
   *
   * @default 3
   */
  interpolationBufferSize?: number;

  /**
   * How often the client sends clock-sync pings to the server, in milliseconds.
   *
   * Shorter intervals converge on an accurate clock offset faster and adapt
   * more quickly to network changes, but generate more traffic. Longer
   * intervals are lighter on bandwidth at the cost of slower adaptation.
   *
   * @default 3000
   */
  clockSyncIntervalMs?: number;

  /**
   * Number of clock-sync round-trip samples kept for the rolling average.
   *
   * A larger window produces a more stable (less noisy) clock offset estimate,
   * but reacts more slowly to sudden network changes. A smaller window adapts
   * faster but is more susceptible to outlier measurements.
   *
   * @default 10
   */
  clockSyncSamples?: number;

  /**
   * Position error threshold (in meters) before a snap-correction is applied
   * to a locally-predicted body.
   *
   * When the server's authoritative position differs from the client's
   * predicted position by more than this distance, the client corrects
   * toward the server state. A higher value is more tolerant of small
   * discrepancies; a lower value keeps the client tightly in sync but may
   * cause visible corrections on lossy connections.
   *
   * @default 0.1
   */
  reconciliationThreshold?: number;
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

  // Geometry registry (content-hash deduplication)
  private geometryCache: Map<string, GeometryDefData> = new Map();
  private sentGeometryHashes: Set<string> = new Set();

  // Material & texture registry
  private materialCache: Map<string, MaterialDefData> = new Map();
  private textureCache: Map<string, TextureDefData> = new Map();
  private sentMaterialHashes: Set<string> = new Set();
  private sentTextureHashes: Set<string> = new Set();
  private textureObjectUrls: Map<string, string> = new Map();

  // Constraint network tracking
  private constraintToNetId = new Map<PhysicsConstraint, string>();
  private localConstraintIds = new Set<string>();
  private remoteConstraintJoints = new Map<string, RAPIER.ImpulseJoint>();

  // Explicit mass set via setMassProperties (avoids Rapier collider-recompute clobbering)
  private bodyMassOverride = new Map<PhysicsBody, number>();

  // Collision event counter
  private collisionCount = 0;

  private config: NetworkedRapierPluginConfig;
  private simulationResetCallbacks: Array<() => void> = [];
  private stateUpdateCallbacks: Array<(state: RoomSnapshot) => void> = [];

  constructor(rapier: typeof RAPIER, gravity: Vector3, config: NetworkedRapierPluginConfig) {
    super(rapier, gravity);
    this.config = config;
    this.syncClient = new PhysicsSyncClient({
      renderDelayMs: config.renderDelayMs,
      interpolationBufferSize: config.interpolationBufferSize,
      clockSyncIntervalMs: config.clockSyncIntervalMs,
      clockSyncSamples: config.clockSyncSamples,
      reconciliationThreshold: config.reconciliationThreshold,
    });
  }

  static async createAsync(
    rapier: typeof RAPIER,
    gravity: Vector3,
    config: NetworkedRapierPluginConfig,
    scene: Scene,
  ): Promise<{ plugin: NetworkedRapierPlugin; snapshot: RoomSnapshot }> {
    const plugin = new NetworkedRapierPlugin(rapier, gravity, config);
    scene.enablePhysics(gravity, plugin);
    const snapshot = await plugin.connect(scene);
    return { plugin, snapshot };
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

    // Wire up server callbacks BEFORE joining room, so late-joiner
    // body replay and mesh data are handled properly
    this.syncClient.onBodyAdded((descriptor) => this.handleBodyAdded(descriptor));
    this.syncClient.onBodyRemoved((bodyId) => this.handleBodyRemoved(bodyId));
    this.syncClient.onMeshBinary((msg) => this.handleMeshBinaryReceived(msg));
    this.syncClient.onGeometryDef((data) => this.handleGeometryDefReceived(data));
    this.syncClient.onMeshRef((data) => this.handleMeshRefReceived(data));
    this.syncClient.onMaterialDef((data) => this.handleMaterialDefReceived(data));
    this.syncClient.onTextureDef((data) => this.handleTextureDefReceived(data));
    this.syncClient.onSimulationStarted((freshSnapshot) => this.handleSimulationStarted(freshSnapshot));
    this.syncClient.onCollisionEvents((events) => {
      this.collisionCount += events.length;
      this.injectCollisionEvents(events);
    });
    this.syncClient.onConstraintAdded((descriptor) => this.handleConstraintAdded(descriptor));
    this.syncClient.onConstraintRemoved((constraintId) => this.handleConstraintRemoved(constraintId));
    this.syncClient.onConstraintUpdated((constraintId, updates) => this.handleConstraintUpdated(constraintId, updates));
    this.syncClient.onStateUpdate((state) => {
      for (const cb of this.stateUpdateCallbacks) cb(state);
    });

    const snapshot = await this.syncClient.joinRoom(this.config.roomId);
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
      // Store pending info — ID assignment is deferred to setShape() because
      // BabylonJS sets body.transformNode AFTER calling initBody, so the
      // mesh name isn't available yet here.
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
      const pending = this.pendingBodies.get(body);
      const shapeInfo = this.shapeParamsCache.get(shape);

      if (pending && shapeInfo) {
        // Assign body ID now — transformNode is set by this point
        const name = body.transformNode?.name;
        const bodyId = name || crypto.randomUUID();
        this.bodyToId.set(body, bodyId);
        this.idToBody.set(bodyId, body);
        this.registerBodyId(bodyId, body);
        // Store pending descriptor. Microtask fires after PhysicsAggregate
        // constructor completes, ensuring mass and material are both available.
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

  setMassProperties(body: PhysicsBody, massProps: PhysicsMassProperties, instanceIndex?: number): void {
    super.setMassProperties(body, massProps, instanceIndex);
    if (massProps.mass !== undefined) {
      this.bodyMassOverride.set(body, massProps.mass);
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
      this.syncClient.removeBody(bodyId);
      // Dispose the mesh (matches handleBodyRemoved behavior)
      const tn = body.transformNode;
      if (tn && !tn.isDisposed()) {
        tn.dispose();
      }

      this.bodyToId.delete(body);
      this.idToBody.delete(bodyId);
      this.unregisterBodyId(bodyId);
      this.remoteBodies.delete(bodyId);
      this.pendingBodies.delete(body);
      this.bodyMassOverride.delete(body);
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
        this.registerBodyId(descriptor.id, body);
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
      this.unregisterBodyId(bodyId);
      this.remoteBodies.delete(bodyId);
    }
  }

  private handleSimulationStarted(freshSnapshot: RoomSnapshot): void {
    // Snapshot entries before clearing to avoid concurrent modification
    const entries = Array.from(this.bodyToId.entries());
    this.bodyToId.clear();
    this.idToBody.clear();
    this.bodyIdToPhysicsBody.clear();
    this.pendingBodies.clear();
    this.remoteBodies.clear();
    this.geometryCache.clear();
    this.sentGeometryHashes.clear();
    this.materialCache.clear();
    this.textureCache.clear();
    this.sentMaterialHashes.clear();
    this.sentTextureHashes.clear();
    // Revoke object URLs to prevent memory leaks
    for (const [, url] of this.textureObjectUrls) {
      URL.revokeObjectURL(url);
    }
    this.textureObjectUrls.clear();
    this.collisionCount = 0;

    // Clean up remote constraint joints
    for (const [, joint] of this.remoteConstraintJoints) {
      this.world.removeImpulseJoint(joint, true);
    }
    this.remoteConstraintJoints.clear();
    this.constraintToNetId.clear();
    this.localConstraintIds.clear();

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

    // Prefer explicitly-set mass (immune to Rapier collider recomputation)
    // over rb.mass() which can be clobbered by recomputeMassPropertiesFromColliders.
    const massOverride = this.bodyMassOverride.get(body);
    const rb = this.bodyToRigidBody.get(body);
    const mass = massOverride !== undefined ? massOverride : (rb ? rb.mass() : undefined);

    // If the mesh's metadata has `owned: true`, request ownership so the server
    // auto-removes this body when the client disconnects.
    const owned = body.transformNode?.metadata?.owned === true;

    return {
      id: bodyId,
      shape: shapeDescriptor,
      motionType,
      position: { x: pending.position.x, y: pending.position.y, z: pending.position.z },
      rotation: { x: pending.orientation.x, y: pending.orientation.y, z: pending.orientation.z, w: pending.orientation.w },
      mass,
      friction: material.friction,
      restitution: material.restitution,
      ownerId: owned ? (this.syncClient.getClientId() ?? '__self__') : undefined,
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

    // Extract full material properties
    let diffuseColor: { r: number; g: number; b: number } = { r: 0.5, g: 0.5, b: 0.5 };
    let specularColor: { r: number; g: number; b: number } = { r: 0.3, g: 0.3, b: 0.3 };
    let emissiveColor: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };
    let ambientColor: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };
    let alpha = 1;
    let specularPower = 64;
    let diffuseTextureHash: string | undefined;
    let normalTextureHash: string | undefined;
    let specularTextureHash: string | undefined;
    let emissiveTextureHash: string | undefined;

    const mat = mesh.material as StandardMaterial | null;
    if (mat) {
      diffuseColor = { r: mat.diffuseColor.r, g: mat.diffuseColor.g, b: mat.diffuseColor.b };
      specularColor = { r: mat.specularColor.r, g: mat.specularColor.g, b: mat.specularColor.b };
      emissiveColor = { r: mat.emissiveColor.r, g: mat.emissiveColor.g, b: mat.emissiveColor.b };
      ambientColor = { r: mat.ambientColor.r, g: mat.ambientColor.g, b: mat.ambientColor.b };
      alpha = mat.alpha;
      specularPower = mat.specularPower;

      // Extract textures via _buffer (BabylonJS internal)
      if (mat.diffuseTexture) {
        diffuseTextureHash = this.extractAndSendTexture(mat.diffuseTexture);
      }
      if (mat.bumpTexture) {
        normalTextureHash = this.extractAndSendTexture(mat.bumpTexture);
      }
      if (mat.specularTexture) {
        specularTextureHash = this.extractAndSendTexture(mat.specularTexture);
      }
      if (mat.emissiveTexture) {
        emissiveTextureHash = this.extractAndSendTexture(mat.emissiveTexture);
      }
    }

    // Content-hash deduplication: send GEOMETRY_DEF only once per unique geometry
    const hash = computeGeometryHash(positions, normals, uvs, colors, indices);

    if (!this.sentGeometryHashes.has(hash)) {
      const geomEncoded = encodeGeometryDef(hash, positions, normals, uvs, colors, indices);
      this.syncClient.sendGeometryDef(geomEncoded);
      this.sentGeometryHashes.add(hash);
      // Cache locally so we can apply geometry if we receive a MeshRef for our own hash
      this.geometryCache.set(hash, { hash, positions, normals, uvs, colors, indices });
    }

    // Compute material hash and send MATERIAL_DEF if new
    const matHash = computeMaterialHash(
      diffuseColor, specularColor, emissiveColor, ambientColor,
      alpha, specularPower,
      diffuseTextureHash, normalTextureHash, specularTextureHash, emissiveTextureHash,
    );

    if (!this.sentMaterialHashes.has(matHash)) {
      const matDef: MaterialDefData = {
        hash: matHash,
        diffuseColor, specularColor, emissiveColor, ambientColor,
        alpha, specularPower,
        diffuseTextureHash, normalTextureHash, specularTextureHash, emissiveTextureHash,
      };
      const matEncoded = encodeMaterialDef(matDef);
      this.syncClient.sendMaterialDef(matEncoded);
      this.sentMaterialHashes.add(matHash);
      this.materialCache.set(matHash, matDef);
    }

    // Always send MESH_REF (small message per body)
    const refEncoded = encodeMeshRef(bodyId, hash, matHash);
    this.syncClient.sendMeshRef(refEncoded);
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

  private handleGeometryDefReceived(data: GeometryDefData): void {
    // Cache the geometry and mark the hash as known
    this.geometryCache.set(data.hash, data);
    this.sentGeometryHashes.add(data.hash);
  }

  private handleMeshRefReceived(data: MeshRefData): void {
    const body = this.idToBody.get(data.bodyId);
    if (!body) return;

    const scene = this.scene;
    if (!scene) return;

    const tn = body.transformNode;
    if (!tn) return;

    const geom = this.geometryCache.get(data.geometryHash);
    if (!geom) return;

    const mesh = tn as Mesh;

    // Apply geometry from the cached GEOMETRY_DEF
    const vertexData = new VertexData();
    vertexData.positions = geom.positions;
    if (geom.normals) vertexData.normals = geom.normals;
    if (geom.uvs) vertexData.uvs = geom.uvs;
    if (geom.colors) vertexData.colors = geom.colors;
    vertexData.indices = geom.indices;
    vertexData.applyToMesh(mesh);

    // Apply material from the cached MATERIAL_DEF
    const matDef = this.materialCache.get(data.materialHash);
    const oldMat = mesh.material;
    if (oldMat) oldMat.dispose();
    const mat = new StandardMaterial(`${data.bodyId}Mat_ref`, scene);

    if (matDef) {
      mat.diffuseColor = new Color3(matDef.diffuseColor.r, matDef.diffuseColor.g, matDef.diffuseColor.b);
      mat.specularColor = new Color3(matDef.specularColor.r, matDef.specularColor.g, matDef.specularColor.b);
      mat.emissiveColor = new Color3(matDef.emissiveColor.r, matDef.emissiveColor.g, matDef.emissiveColor.b);
      mat.ambientColor = new Color3(matDef.ambientColor.r, matDef.ambientColor.g, matDef.ambientColor.b);
      mat.alpha = matDef.alpha;
      mat.specularPower = matDef.specularPower;

      // Apply textures from cache
      if (matDef.diffuseTextureHash) {
        mat.diffuseTexture = this.createTextureFromCache(matDef.diffuseTextureHash, scene);
      }
      if (matDef.normalTextureHash) {
        mat.bumpTexture = this.createTextureFromCache(matDef.normalTextureHash, scene);
      }
      if (matDef.specularTextureHash) {
        mat.specularTexture = this.createTextureFromCache(matDef.specularTextureHash, scene);
      }
      if (matDef.emissiveTextureHash) {
        mat.emissiveTexture = this.createTextureFromCache(matDef.emissiveTextureHash, scene);
      }
    } else {
      // Fallback: no material def found, use defaults
      mat.diffuseColor = new Color3(0.5, 0.5, 0.5);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
    }

    mesh.material = mat;
  }

  private handleMaterialDefReceived(data: MaterialDefData): void {
    this.materialCache.set(data.hash, data);
    this.sentMaterialHashes.add(data.hash);
  }

  private handleTextureDefReceived(data: TextureDefData): void {
    this.textureCache.set(data.hash, data);
    this.sentTextureHashes.add(data.hash);
  }

  private extractAndSendTexture(texture: BaseTexture): string | undefined {
    try {
      // Access BabylonJS internal _buffer for original image bytes
      const buffer = (texture as unknown as { _buffer: ArrayBuffer | null })._buffer;
      if (!buffer) return undefined;

      const imageData = new Uint8Array(buffer);
      const texHash = computeTextureHash(imageData);

      if (!this.sentTextureHashes.has(texHash)) {
        const encoded = encodeTextureDef(texHash, imageData);
        this.syncClient.sendTextureDef(encoded);
        this.sentTextureHashes.add(texHash);
        this.textureCache.set(texHash, { hash: texHash, imageData });
      }

      return texHash;
    } catch {
      // Gracefully skip textures that can't be extracted
      return undefined;
    }
  }

  private createTextureFromCache(hash: string, scene: Scene): Texture | null {
    const texData = this.textureCache.get(hash);
    if (!texData) return null;

    // Reuse existing object URL or create a new one
    let url = this.textureObjectUrls.get(hash);
    if (!url) {
      const blob = new Blob([new Uint8Array(texData.imageData)]);
      url = URL.createObjectURL(blob);
      this.textureObjectUrls.set(hash, url);
    }

    return new Texture(url, scene);
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

  // --- Constraint override (forward to server) ---

  addConstraint(body: PhysicsBody, childBody: PhysicsBody, constraint: PhysicsConstraint, _instanceIndex?: number, _childInstanceIndex?: number): void {
    // Create locally so Rapier state stays consistent
    super.addConstraint(body, childBody, constraint);

    const bodyIdA = this.bodyToId.get(body);
    const bodyIdB = this.bodyToId.get(childBody);
    if (bodyIdA && bodyIdB) {
      const descriptor = buildConstraintDescriptor(constraint);
      descriptor.id = `${bodyIdA}_${bodyIdB}_${crypto.randomUUID().slice(0, 8)}`;
      descriptor.bodyIdA = bodyIdA;
      descriptor.bodyIdB = bodyIdB;

      // Track constraint ID for network lifecycle
      this.constraintToNetId.set(constraint, descriptor.id);
      this.localConstraintIds.add(descriptor.id);

      // Defer to ensure body descriptors (sent eagerly from setMaterial
      // or via microtask fallback) are dispatched first
      queueMicrotask(() => {
        queueMicrotask(() => {
          this.syncClient.addConstraint(descriptor);
        });
      });
    }
  }

  // --- Constraint lifecycle overrides ---

  disposeConstraint(constraint: PhysicsConstraint): void {
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.removeConstraint(netId);
      this.constraintToNetId.delete(constraint);
      this.localConstraintIds.delete(netId);
    }
    super.disposeConstraint(constraint);
  }

  setEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    super.setEnabled(constraint, isEnabled);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { enabled: isEnabled });
    }
  }

  setCollisionsEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    super.setCollisionsEnabled(constraint, isEnabled);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { collisionsEnabled: isEnabled });
    }
  }

  setAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limitMode: PhysicsConstraintAxisLimitMode): void {
    super.setAxisMode(constraint, axis, limitMode);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, mode: limitMode as number }] });
    }
  }

  setAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, minLimit: number): void {
    super.setAxisMinLimit(constraint, axis, minLimit);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, minLimit }] });
    }
  }

  setAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limit: number): void {
    super.setAxisMaxLimit(constraint, axis, limit);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, maxLimit: limit }] });
    }
  }

  setAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, motorType: PhysicsConstraintMotorType): void {
    super.setAxisMotorType(constraint, axis, motorType);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, motorType: motorType as number }] });
    }
  }

  setAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, target: number): void {
    super.setAxisMotorTarget(constraint, axis, target);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, motorTarget: target }] });
    }
  }

  setAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, maxForce: number): void {
    super.setAxisMotorMaxForce(constraint, axis, maxForce);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, motorMaxForce: maxForce }] });
    }
  }

  setAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, friction: number): void {
    super.setAxisFriction(constraint, axis, friction);
    const netId = this.constraintToNetId.get(constraint);
    if (netId) {
      this.syncClient.updateConstraint(netId, { axisUpdates: [{ axis: axis as number, friction }] });
    }
  }

  // --- Constraint incoming handlers ---

  private handleConstraintAdded(descriptor: ConstraintDescriptor): void {
    // Skip if this is our own constraint echoed back
    if (this.localConstraintIds.has(descriptor.id)) return;

    // Look up the local PhysicsBody objects
    const bodyA = this.idToBody.get(descriptor.bodyIdA);
    const bodyB = this.idToBody.get(descriptor.bodyIdB);
    if (!bodyA || !bodyB) return;

    const rbA = this.bodyToRigidBody.get(bodyA);
    const rbB = this.bodyToRigidBody.get(bodyB);
    if (!rbA || !rbB) return;

    // Create Rapier joint directly from descriptor (no BabylonJS PhysicsConstraint needed)
    const jointData = createJointData(this.rapier, descriptor);
    const joint = this.world.createImpulseJoint(jointData, rbA, rbB, true);
    if (descriptor.collision === false) {
      joint.setContactsEnabled(false);
    }
    this.remoteConstraintJoints.set(descriptor.id, joint);
  }

  private handleConstraintRemoved(constraintId: string): void {
    // Remote constraint?
    const remoteJoint = this.remoteConstraintJoints.get(constraintId);
    if (remoteJoint) {
      this.world.removeImpulseJoint(remoteJoint, true);
      this.remoteConstraintJoints.delete(constraintId);
      return;
    }

    // Local constraint removed by server/another client — find and dispose
    for (const [constraint, netId] of this.constraintToNetId) {
      if (netId === constraintId) {
        super.disposeConstraint(constraint);
        this.constraintToNetId.delete(constraint);
        this.localConstraintIds.delete(constraintId);
        return;
      }
    }
  }

  private handleConstraintUpdated(constraintId: string, updates: ConstraintUpdates): void {
    // Try remote constraint first
    const remoteJoint = this.remoteConstraintJoints.get(constraintId);
    if (remoteJoint) {
      this.applyUpdatesToJoint(remoteJoint, updates);
      return;
    }

    // Try local constraint
    for (const [constraint, netId] of this.constraintToNetId) {
      if (netId === constraintId) {
        const joint = this.constraintToJoint.get(constraint);
        if (joint) {
          this.applyUpdatesToJoint(joint, updates);
        }
        return;
      }
    }
  }

  private applyUpdatesToJoint(joint: RAPIER.ImpulseJoint, updates: ConstraintUpdates): void {
    if (updates.enabled !== undefined) {
      (joint as any).setEnabled?.(updates.enabled);
    }
    if (updates.collisionsEnabled !== undefined) {
      joint.setContactsEnabled(updates.collisionsEnabled);
    }
    if (updates.axisUpdates) {
      for (const au of updates.axisUpdates) {
        if (au.minLimit !== undefined && au.maxLimit !== undefined) {
          (joint as any).setLimits?.(au.minLimit, au.maxLimit);
        }
        if (au.motorTarget !== undefined) {
          const maxForce = au.motorMaxForce ?? 1000;
          if (au.motorType === 1) { // velocity
            (joint as any).configureMotorVelocity?.(au.motorTarget, maxForce);
          } else {
            (joint as any).configureMotorPosition?.(au.motorTarget, maxForce, 0);
          }
        }
      }
    }
  }

  // --- Babylon.js physics API overrides (forward to server) ---

  private vec3ToPlain(v: Vector3): { x: number; y: number; z: number } {
    return { x: v.x, y: v.y, z: v.z };
  }

  applyForce(body: PhysicsBody, force: Vector3, location: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'applyForce', bodyId, data: { force: this.vec3ToPlain(force), point: this.vec3ToPlain(location) } }]);
  }

  applyImpulse(body: PhysicsBody, impulse: Vector3, location: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'applyImpulse', bodyId, data: { impulse: this.vec3ToPlain(impulse), point: this.vec3ToPlain(location) } }]);
  }

  applyAngularImpulse(body: PhysicsBody, angularImpulse: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'applyAngularImpulse', bodyId, data: { angImpulse: this.vec3ToPlain(angularImpulse) } }]);
  }

  applyTorque(body: PhysicsBody, torque: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'applyTorque', bodyId, data: { torque: this.vec3ToPlain(torque) } }]);
  }

  setLinearVelocity(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'setVelocity', bodyId, data: { linVel: this.vec3ToPlain(linVel) } }]);
  }

  setAngularVelocity(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([{ type: 'setAngularVelocity', bodyId, data: { angVel: this.vec3ToPlain(angVel) } }]);
  }

  setTargetTransform(body: PhysicsBody, position: Vector3, rotation: Quaternion, _instanceIndex?: number): void {
    const bodyId = this.bodyToId.get(body);
    if (!bodyId) return;
    this.sendInput([
      { type: 'setPosition', bodyId, data: { position: this.vec3ToPlain(position) } },
      { type: 'setRotation', bodyId, data: { rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } } },
    ]);
  }

  // --- Async server-side shape query methods ---

  async shapeCastAsync(
    shape: ShapeDescriptor,
    startPosition: Vec3,
    endPosition: Vec3,
    rotation: Quat,
    ignoreBodyId?: string,
  ): Promise<ShapeCastResponse & { hitBody?: PhysicsBody }> {
    const response = await this.syncClient.shapeCastQuery(shape, startPosition, endPosition, rotation, ignoreBodyId);
    return {
      ...response,
      hitBody: response.hitBodyId ? this.idToBody.get(response.hitBodyId) : undefined,
    };
  }

  async shapeProximityAsync(
    shape: ShapeDescriptor,
    position: Vec3,
    rotation: Quat,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<ShapeProximityResponse & { hitBody?: PhysicsBody }> {
    const response = await this.syncClient.shapeProximityQuery(shape, position, rotation, maxDistance, ignoreBodyId);
    return {
      ...response,
      hitBody: response.hitBodyId ? this.idToBody.get(response.hitBodyId) : undefined,
    };
  }

  async pointProximityAsync(
    position: Vec3,
    maxDistance: number,
    ignoreBodyId?: string,
  ): Promise<PointProximityResponse & { hitBody?: PhysicsBody }> {
    const response = await this.syncClient.pointProximityQuery(position, maxDistance, ignoreBodyId);
    return {
      ...response,
      hitBody: response.hitBodyId ? this.idToBody.get(response.hitBodyId) : undefined,
    };
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
