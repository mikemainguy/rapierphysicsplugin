import type RAPIER from '@dimforge/rapier3d-compat';
import {
  Color3,
  PhysicsMotionType,
} from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeParameters,
  PhysicsShapeType,
  PhysicsMassProperties,
  PhysicsConstraint,
  Scene,
} from '@babylonjs/core';
import type {
  ComputeConfig,
  ConstraintUpdates,
  RoomSnapshot,
  MotionType,
  GeometryDefData,
  MaterialDefData,
  TextureDefData,
} from '@rapierphysicsplugin/shared';
import type { RapierPluginState } from '../rapier/types.js';
import type { PhysicsSyncClient } from '../sync/sync-client.js';

// Colors for different shape types (matches demo)
export const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
};
export const staticColor = new Color3(0.4, 0.4, 0.45);

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

export interface PendingBodyInfo {
  motionType: PhysicsMotionType;
  position: import('@babylonjs/core').Vector3;
  orientation: import('@babylonjs/core').Quaternion;
}

export interface CachedShapeInfo {
  type: PhysicsShapeType;
  options: PhysicsShapeParameters;
}

export interface NetworkedPluginState extends RapierPluginState {
  eventQueue: RAPIER.EventQueue;
  syncClient: PhysicsSyncClient;
  scene: Scene | null;
  bodyToId: Map<PhysicsBody, string>;
  idToBody: Map<string, PhysicsBody>;
  pendingBodies: Map<PhysicsBody, PendingBodyInfo>;
  shapeParamsCache: Map<PhysicsShape, CachedShapeInfo>;
  pendingDescriptors: Map<PhysicsShape, {
    body: PhysicsBody;
    bodyId: string;
    pending: PendingBodyInfo;
    shapeInfo: CachedShapeInfo;
    shape: PhysicsShape;
    sent: boolean;
  }>;
  remoteBodyCreationIds: Set<string>;
  remoteBodies: Set<string>;
  geometryCache: Map<string, GeometryDefData>;
  sentGeometryHashes: Set<string>;
  materialCache: Map<string, MaterialDefData>;
  textureCache: Map<string, TextureDefData>;
  sentMaterialHashes: Set<string>;
  sentTextureHashes: Set<string>;
  textureObjectUrls: Map<string, string>;
  constraintToNetId: Map<PhysicsConstraint, string>;
  localConstraintIds: Set<string>;
  remoteConstraintJoints: Map<string, RAPIER.ImpulseJoint>;
  bodyMassOverride: Map<PhysicsBody, number>;
  collisionCount: number;
  config: NetworkedRapierPluginConfig;
  simulationResetCallbacks: Array<() => void>;
  stateUpdateCallbacks: Array<(state: RoomSnapshot) => void>;
}

export function motionTypeToWire(motionType: PhysicsMotionType): MotionType {
  switch (motionType) {
    case PhysicsMotionType.DYNAMIC: return 'dynamic';
    case PhysicsMotionType.STATIC: return 'static';
    case PhysicsMotionType.ANIMATED: return 'kinematic';
    default: return 'dynamic';
  }
}

export function motionTypeFromWire(motionType: MotionType): PhysicsMotionType {
  switch (motionType) {
    case 'dynamic': return PhysicsMotionType.DYNAMIC;
    case 'static': return PhysicsMotionType.STATIC;
    case 'kinematic': return PhysicsMotionType.ANIMATED;
    default: return PhysicsMotionType.DYNAMIC;
  }
}
