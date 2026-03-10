import type RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, PhysicsShapeType } from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeParameters,
  PhysicsMassProperties,
  PhysicsConstraint,
  PhysicsConstraintAxisLimitMode,
  PhysicsConstraintMotorType,
  PhysicsConstraintAxis,
} from '@babylonjs/core';
import type { Scene, Nullable } from '@babylonjs/core';
import type {
  InputAction,
  CollisionEventData,
  RoomSnapshot,
  Vec3,
  Quat,
  ShapeDescriptor,
  ShapeCastResponse,
  ShapeProximityResponse,
  PointProximityResponse,
  GeometryDefData,
  MaterialDefData,
  TextureDefData,
} from '@rapierphysicsplugin/shared';
import { RapierPlugin } from '../rapier/plugin.js';
import { PhysicsSyncClient } from '../sync/sync-client.js';
import type { NetworkedRapierPluginConfig, PendingBodyInfo, CachedShapeInfo } from './types.js';
import * as bodyOps from './body-ops.js';
import * as meshOps from './mesh-ops.js';
import * as remoteOps from './remote-body-ops.js';
import * as constraintOps from './constraint-ops.js';
import * as queryOps from './query-ops.js';

export type { NetworkedRapierPluginConfig } from './types.js';

export class NetworkedRapierPlugin extends RapierPlugin {
  public syncClient: PhysicsSyncClient;
  public scene: Scene | null = null;
  public bodyToId = new Map<PhysicsBody, string>();
  public idToBody = new Map<string, PhysicsBody>();
  public pendingBodies = new Map<PhysicsBody, PendingBodyInfo>();
  public shapeParamsCache = new Map<PhysicsShape, CachedShapeInfo>();
  public pendingDescriptors = new Map<PhysicsShape, {
    body: PhysicsBody; bodyId: string; pending: PendingBodyInfo;
    shapeInfo: CachedShapeInfo; shape: PhysicsShape; sent: boolean;
  }>();
  public remoteBodyCreationIds = new Set<string>();
  public remoteBodies = new Set<string>();
  public geometryCache: Map<string, GeometryDefData> = new Map();
  public sentGeometryHashes: Set<string> = new Set();
  public materialCache: Map<string, MaterialDefData> = new Map();
  public textureCache: Map<string, TextureDefData> = new Map();
  public sentMaterialHashes: Set<string> = new Set();
  public sentTextureHashes: Set<string> = new Set();
  public textureObjectUrls: Map<string, string> = new Map();
  public constraintToNetId = new Map<PhysicsConstraint, string>();
  public localConstraintIds = new Set<string>();
  public remoteConstraintJoints = new Map<string, RAPIER.ImpulseJoint>();
  public bodyMassOverride = new Map<PhysicsBody, number>();
  public collisionCount = 0;
  public config: NetworkedRapierPluginConfig;
  public simulationResetCallbacks: Array<() => void> = [];
  public stateUpdateCallbacks: Array<(state: RoomSnapshot) => void> = [];

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

  async connect(scene?: Scene): Promise<RoomSnapshot> {
    if (scene) this.scene = scene;

    await this.syncClient.connect(this.config.serverUrl);

    this.syncClient.onBodyAdded((d) => remoteOps.handleBodyAdded(this, d));
    this.syncClient.onBodyRemoved((id) => remoteOps.handleBodyRemoved(this, id));
    this.syncClient.onMeshBinary((msg) => meshOps.handleMeshBinaryReceived(this, msg));
    this.syncClient.onGeometryDef((data) => meshOps.handleGeometryDefReceived(this, data));
    this.syncClient.onMeshRef((data) => meshOps.handleMeshRefReceived(this, data));
    this.syncClient.onMaterialDef((data) => meshOps.handleMaterialDefReceived(this, data));
    this.syncClient.onTextureDef((data) => meshOps.handleTextureDefReceived(this, data));
    this.syncClient.onSimulationStarted((freshSnapshot) => this.handleSimulationStarted(freshSnapshot));
    this.syncClient.onCollisionEvents((events) => {
      this.collisionCount += events.length;
      this.injectCollisionEvents(events);
    });
    this.syncClient.onConstraintAdded((d) => this.handleConstraintAdded(d));
    this.syncClient.onConstraintRemoved((id) => this.handleConstraintRemoved(id));
    this.syncClient.onConstraintUpdated((id, updates) => constraintOps.handleConstraintUpdated(this, id, updates));
    this.syncClient.onStateUpdate((state) => {
      for (const cb of this.stateUpdateCallbacks) cb(state);
    });

    return await this.syncClient.joinRoom(this.config.roomId);
  }

  // --- Body lifecycle overrides ---

  initBody(body: PhysicsBody, motionType: import('@babylonjs/core').PhysicsMotionType, position: Vector3, orientation: Quaternion): void {
    super.initBody(body, motionType, position, orientation);
    bodyOps.onInitBody(this, body, motionType, position, orientation);
  }

  initShape(shape: PhysicsShape, type: PhysicsShapeType, options: PhysicsShapeParameters): void {
    super.initShape(shape, type, options);
    bodyOps.onInitShape(this, shape, type, options);
  }

  setShape(body: PhysicsBody, shape: Nullable<PhysicsShape>): void {
    super.setShape(body, shape);
    bodyOps.onSetShape(this, body, shape, (b, id) => this.sendMeshBinaryForBody(b, id));
  }

  sendMeshBinaryForBody(body: PhysicsBody, bodyId: string): void {
    meshOps.sendMeshBinaryForBody(this, body, bodyId);
  }

  setMassProperties(body: PhysicsBody, massProps: PhysicsMassProperties, instanceIndex?: number): void {
    super.setMassProperties(body, massProps, instanceIndex);
    bodyOps.onSetMassProperties(this, body, massProps);
  }

  executeStep(delta: number, bodies: Array<PhysicsBody>): void {
    bodyOps.onExecuteStep(this, delta, bodies);
  }

  sync(body: PhysicsBody): void {
    if (bodyOps.onSync(this, body)) return;
    super.sync(body);
  }

  removeBody(body: PhysicsBody): void {
    bodyOps.onRemoveBody(this, body);
    super.removeBody(body);
  }

  // --- Server callback handlers (also called directly by tests) ---

  private handleSimulationStarted(freshSnapshot: RoomSnapshot): void {
    const bodiesToRemove = remoteOps.handleSimulationStarted(this, freshSnapshot);
    for (const body of bodiesToRemove) {
      super.removeBody(body);
    }
  }

  private handleConstraintAdded(descriptor: import('@rapierphysicsplugin/shared').ConstraintDescriptor): void {
    constraintOps.handleConstraintAdded(this, descriptor);
  }

  private handleConstraintRemoved(constraintId: string): void {
    const constraint = constraintOps.handleConstraintRemoved(this, constraintId);
    if (constraint) {
      super.disposeConstraint(constraint);
    }
  }

  // --- Constraint overrides ---

  addConstraint(body: PhysicsBody, childBody: PhysicsBody, constraint: PhysicsConstraint, _instanceIndex?: number, _childInstanceIndex?: number): void {
    super.addConstraint(body, childBody, constraint);
    constraintOps.onAddConstraint(this, body, childBody, constraint);
  }

  disposeConstraint(constraint: PhysicsConstraint): void {
    constraintOps.onDisposeConstraint(this, constraint);
    super.disposeConstraint(constraint);
  }

  setEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    super.setEnabled(constraint, isEnabled);
    constraintOps.sendConstraintUpdate(this, constraint, { enabled: isEnabled });
  }

  setCollisionsEnabled(constraint: PhysicsConstraint, isEnabled: boolean): void {
    super.setCollisionsEnabled(constraint, isEnabled);
    constraintOps.sendConstraintUpdate(this, constraint, { collisionsEnabled: isEnabled });
  }

  setAxisMode(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limitMode: PhysicsConstraintAxisLimitMode): void {
    super.setAxisMode(constraint, axis, limitMode);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, mode: limitMode as number }] });
  }

  setAxisMinLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, minLimit: number): void {
    super.setAxisMinLimit(constraint, axis, minLimit);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, minLimit }] });
  }

  setAxisMaxLimit(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, limit: number): void {
    super.setAxisMaxLimit(constraint, axis, limit);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, maxLimit: limit }] });
  }

  setAxisMotorType(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, motorType: PhysicsConstraintMotorType): void {
    super.setAxisMotorType(constraint, axis, motorType);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, motorType: motorType as number }] });
  }

  setAxisMotorTarget(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, target: number): void {
    super.setAxisMotorTarget(constraint, axis, target);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, motorTarget: target }] });
  }

  setAxisMotorMaxForce(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, maxForce: number): void {
    super.setAxisMotorMaxForce(constraint, axis, maxForce);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, motorMaxForce: maxForce }] });
  }

  setAxisFriction(constraint: PhysicsConstraint, axis: PhysicsConstraintAxis, friction: number): void {
    super.setAxisFriction(constraint, axis, friction);
    constraintOps.sendConstraintUpdate(this, constraint, { axisUpdates: [{ axis: axis as number, friction }] });
  }

  // --- Physics API overrides (forward to server) ---

  applyForce(body: PhysicsBody, force: Vector3, location: Vector3, _instanceIndex?: number): void {
    queryOps.applyForce(this, body, force, location);
  }

  applyImpulse(body: PhysicsBody, impulse: Vector3, location: Vector3, _instanceIndex?: number): void {
    queryOps.applyImpulse(this, body, impulse, location);
  }

  applyAngularImpulse(body: PhysicsBody, angularImpulse: Vector3, _instanceIndex?: number): void {
    queryOps.applyAngularImpulse(this, body, angularImpulse);
  }

  applyTorque(body: PhysicsBody, torque: Vector3, _instanceIndex?: number): void {
    queryOps.applyTorque(this, body, torque);
  }

  setLinearVelocity(body: PhysicsBody, linVel: Vector3, _instanceIndex?: number): void {
    queryOps.setLinearVelocity(this, body, linVel);
  }

  setAngularVelocity(body: PhysicsBody, angVel: Vector3, _instanceIndex?: number): void {
    queryOps.setAngularVelocity(this, body, angVel);
  }

  setTargetTransform(body: PhysicsBody, position: Vector3, rotation: Quaternion, _instanceIndex?: number): void {
    queryOps.setTargetTransform(this, body, position, rotation);
  }

  // --- Async server queries ---

  async shapeCastAsync(
    shape: ShapeDescriptor, startPosition: Vec3, endPosition: Vec3,
    rotation: Quat, ignoreBodyId?: string,
  ): Promise<ShapeCastResponse & { hitBody?: PhysicsBody }> {
    return queryOps.shapeCastAsync(this, shape, startPosition, endPosition, rotation, ignoreBodyId);
  }

  async shapeProximityAsync(
    shape: ShapeDescriptor, position: Vec3, rotation: Quat,
    maxDistance: number, ignoreBodyId?: string,
  ): Promise<ShapeProximityResponse & { hitBody?: PhysicsBody }> {
    return queryOps.shapeProximityAsync(this, shape, position, rotation, maxDistance, ignoreBodyId);
  }

  async pointProximityAsync(
    position: Vec3, maxDistance: number, ignoreBodyId?: string,
  ): Promise<PointProximityResponse & { hitBody?: PhysicsBody }> {
    return queryOps.pointProximityAsync(this, position, maxDistance, ignoreBodyId);
  }

  // --- Proxy methods for sync client ---

  startSimulation(): void { this.syncClient.startSimulation(); }
  sendInput(actions: InputAction[]): void { this.syncClient.sendInput(actions); }
  onCollisionEvents(callback: (events: CollisionEventData[]) => void): void { this.syncClient.onCollisionEvents(callback); }
  onSimulationReset(callback: () => void): void { this.simulationResetCallbacks.push(callback); }
  onStateUpdate(callback: (state: RoomSnapshot) => void): void { this.stateUpdateCallbacks.push(callback); }
  getSyncClient(): PhysicsSyncClient { return this.syncClient; }
  getClientId(): string | null { return this.syncClient.getClientId(); }
  get simulationRunning(): boolean { return this.syncClient.simulationRunning; }
  get totalBodyCount(): number { return this.syncClient.totalBodyCount; }
  get bytesSent(): number { return this.syncClient.bytesSent; }
  get bytesReceived(): number { return this.syncClient.bytesReceived; }
  get collisionEventCount(): number { return this.collisionCount; }
  getReconciler() { return this.syncClient.getReconciler(); }
  getClockSync() { return this.syncClient.getClockSync(); }
}
