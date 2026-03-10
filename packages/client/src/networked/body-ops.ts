import {
  Vector3,
  Quaternion,
  PhysicsShapeType,
} from '@babylonjs/core';
import type {
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeParameters,
  PhysicsMassProperties,
  PhysicsMotionType,
} from '@babylonjs/core';
import type {
  BodyDescriptor,
  ShapeDescriptor,
  ContainerChildShape,
} from '@rapierphysicsplugin/shared';
import type { NetworkedPluginState, PendingBodyInfo, CachedShapeInfo } from './types.js';
import { motionTypeToWire } from './types.js';
export function onInitBody(
  state: NetworkedPluginState,
  body: PhysicsBody,
  motionType: PhysicsMotionType,
  position: Vector3,
  orientation: Quaternion,
): void {
  if (!state.scene && body.transformNode) {
    state.scene = body.transformNode.getScene();
  }

  if (state.remoteBodyCreationIds.size === 0) {
    state.pendingBodies.set(body, {
      motionType,
      position: position.clone(),
      orientation: orientation.clone(),
    });
  }
}

export function onInitShape(
  state: NetworkedPluginState,
  shape: PhysicsShape,
  type: PhysicsShapeType,
  options: PhysicsShapeParameters,
): void {
  state.shapeParamsCache.set(shape, { type, options });
}

export function onSetShape(
  state: NetworkedPluginState,
  body: PhysicsBody,
  shape: PhysicsShape | null,
  sendMesh: (body: PhysicsBody, bodyId: string) => void,
): void {
  if (state.remoteBodyCreationIds.size === 0 && shape) {
    const pending = state.pendingBodies.get(body);
    const shapeInfo = state.shapeParamsCache.get(shape);

    if (pending && shapeInfo) {
      const name = body.transformNode?.name;
      const bodyId = name || crypto.randomUUID();
      state.bodyToId.set(body, bodyId);
      state.idToBody.set(bodyId, body);
      state.bodyIdToPhysicsBody.set(bodyId, body);

      const record = { body, bodyId, pending, shapeInfo, shape, sent: false };
      state.pendingDescriptors.set(shape, record);
      state.pendingBodies.delete(body);

      queueMicrotask(() => {
        if (!record.sent) {
          record.sent = true;
          state.pendingDescriptors.delete(shape);
          const descriptor = buildDescriptor(state, body, bodyId, pending, shapeInfo, shape);
          if (descriptor) {
            state.syncClient.addBody(descriptor);
            sendMesh(body, bodyId);
          } else {
            // Body can't be serialized — unregister so it doesn't freeze
            console.error(`[RapierPlugin] Failed to serialize body "${bodyId}" (shape type: ${shapeInfo.type}) — unregistering`);
            state.bodyToId.delete(body);
            state.idToBody.delete(bodyId);
            state.bodyIdToPhysicsBody.delete(bodyId);
          }
        }
      });
    }
  }
}

export function onSetMassProperties(
  state: NetworkedPluginState,
  body: PhysicsBody,
  massProps: PhysicsMassProperties,
): void {
  if (massProps.mass !== undefined) {
    state.bodyMassOverride.set(body, massProps.mass);
  }
}

export function onExecuteStep(
  state: NetworkedPluginState,
  _delta: number,
  bodies: Array<PhysicsBody>,
): void {
  state.eventQueue.drainCollisionEvents(() => {});
  state.eventQueue.drainContactForceEvents(() => {});

  const clockSync = state.syncClient.getClockSync();
  const reconciler = state.syncClient.getReconciler();
  const interpolator = reconciler.getInterpolator();
  const serverTime = clockSync.getServerTime();

  interpolator.resetStats();

  for (const body of bodies) {
    const bodyId = state.bodyToId.get(body);
    if (!bodyId) continue;

    const interpolated = reconciler.getInterpolatedRemoteState(bodyId, serverTime);
    if (interpolated) {
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

      const rb = state.bodyToRigidBody.get(body);
      if (rb) {
        rb.setTranslation(
          new state.rapier.Vector3(interpolated.position.x, interpolated.position.y, interpolated.position.z),
          false,
        );
        rb.setRotation(
          new state.rapier.Quaternion(
            interpolated.rotation.x,
            interpolated.rotation.y,
            interpolated.rotation.z,
            interpolated.rotation.w,
          ),
          false,
        );
      }
    }
  }
}

export function onSync(state: NetworkedPluginState, body: PhysicsBody): boolean {
  return state.bodyToId.has(body);
}

export function onRemoveBody(state: NetworkedPluginState, body: PhysicsBody): void {
  const bodyId = state.bodyToId.get(body);
  if (bodyId) {
    state.syncClient.removeBody(bodyId);
    const tn = body.transformNode;
    if (tn && !tn.isDisposed()) {
      tn.dispose();
    }

    state.bodyToId.delete(body);
    state.idToBody.delete(bodyId);
    state.bodyIdToPhysicsBody.delete(bodyId);
    state.remoteBodies.delete(bodyId);
    state.pendingBodies.delete(body);
    state.bodyMassOverride.delete(body);
  }
}

export function buildDescriptor(
  state: NetworkedPluginState,
  body: PhysicsBody,
  bodyId: string,
  pending: PendingBodyInfo,
  shapeInfo: CachedShapeInfo,
  shape: PhysicsShape,
): BodyDescriptor | null {
  const wireMotion = motionTypeToWire(pending.motionType);
  const shapeDescriptor = shapeInfoToDescriptor(shapeInfo, state, shape);
  if (!shapeDescriptor) return null;

  const material = state.shapeMaterialMap.get(shape) ?? { friction: undefined, restitution: undefined };
  const massOverride = state.bodyMassOverride.get(body);
  const rb = state.bodyToRigidBody.get(body);
  const mass = massOverride !== undefined ? massOverride : (rb ? rb.mass() : undefined);
  const owned = body.transformNode?.metadata?.owned === true;

  return {
    id: bodyId,
    shape: shapeDescriptor,
    motionType: wireMotion,
    position: { x: pending.position.x, y: pending.position.y, z: pending.position.z },
    rotation: { x: pending.orientation.x, y: pending.orientation.y, z: pending.orientation.z, w: pending.orientation.w },
    mass,
    friction: material.friction,
    restitution: material.restitution,
    ownerId: owned ? (state.syncClient.getClientId() ?? '__self__') : undefined,
  };
}

export function shapeInfoToDescriptor(
  shapeInfo: CachedShapeInfo,
  state?: NetworkedPluginState,
  parentShape?: PhysicsShape,
): ShapeDescriptor | null {
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
    case PhysicsShapeType.CYLINDER: {
      const pointA = options.pointA ?? new Vector3(0, 0, 0);
      const pointB = options.pointB ?? new Vector3(0, 1, 0);
      const halfHeight = Vector3.Distance(pointA, pointB) / 2;
      const radius = options.radius ?? 0.5;
      return { type: 'cylinder', params: { halfHeight, radius } };
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
    case PhysicsShapeType.CONVEX_HULL: {
      const mesh = options.mesh;
      if (mesh) {
        const positions = mesh.getVerticesData('position');
        if (positions) {
          return {
            type: 'convex_hull',
            params: { vertices: new Float32Array(positions) },
          };
        }
      }
      return null;
    }
    case PhysicsShapeType.HEIGHTFIELD: {
      let heights = options.heightFieldData;
      let numSamplesX = options.numHeightFieldSamplesX ?? 2;
      let numSamplesZ = options.numHeightFieldSamplesZ ?? 2;
      let sizeX = options.heightFieldSizeX ?? 1;
      let sizeZ = options.heightFieldSizeZ ?? 1;

      if (!heights && options.groundMesh) {
        const gm = options.groundMesh as any;
        const subdivX = (gm._subdivisionsX ?? gm.subdivisionsX ?? 1) + 1;
        const subdivZ = (gm._subdivisionsY ?? gm.subdivisionsY ?? 1) + 1;
        numSamplesX = subdivX;
        numSamplesZ = subdivZ;
        const positions = gm.getVerticesData('position');
        if (positions) {
          heights = new Float32Array(subdivX * subdivZ);
          for (let z = 0; z < subdivZ; z++) {
            for (let x = 0; x < subdivX; x++) {
              const bjsRow = (subdivZ - 1) - z; // BJS row 0 = max Z; Rapier col 0 = min Z
              const idx = (bjsRow * subdivX + x) * 3;
              heights[x * subdivZ + z] = positions[idx + 1]; // column-major for Rapier
            }
          }
          const bb = gm.getBoundingInfo().boundingBox;
          sizeX = bb.maximum.x - bb.minimum.x;
          sizeZ = bb.maximum.z - bb.minimum.z;
        }
      }

      if (heights) {
        return {
          type: 'heightfield',
          params: { heights, numSamplesX, numSamplesZ, sizeX, sizeZ },
        };
      }
      return null;
    }
    case PhysicsShapeType.CONTAINER: {
      if (!state || !parentShape) return null;
      const children = state.compoundChildren.get(parentShape) ?? [];
      const wireChildren: ContainerChildShape[] = [];
      for (const entry of children) {
        const childInfo = state.shapeParamsCache.get(entry.child);
        if (!childInfo) continue;
        const childDesc = shapeInfoToDescriptor(childInfo, state, entry.child);
        if (!childDesc) continue;
        wireChildren.push({
          shape: childDesc,
          translation: entry.translation
            ? { x: entry.translation.x, y: entry.translation.y, z: entry.translation.z }
            : undefined,
          rotation: entry.rotation
            ? { x: entry.rotation.x, y: entry.rotation.y, z: entry.rotation.z, w: entry.rotation.w }
            : undefined,
        });
      }
      if (wireChildren.length === 0) return null;
      return { type: 'container', params: { children: wireChildren } };
    }
    default:
      return null;
  }
}
