import {
  Vector3,
  Quaternion,
  MeshBuilder,
  StandardMaterial,
  Color3,
  PhysicsShapeType,
  PhysicsBody,
  PhysicsShape,
  Mesh,
} from '@babylonjs/core';
import type {
  BodyDescriptor,
  BoxShapeParams,
  SphereShapeParams,
  CapsuleShapeParams,
  RoomSnapshot,
} from '@rapierphysicsplugin/shared';
import type { NetworkedPluginState } from './networked-plugin-types.js';
import { shapeColors, staticColor, motionTypeFromWire } from './networked-plugin-types.js';

export function handleBodyAdded(state: NetworkedPluginState, descriptor: BodyDescriptor): void {
  if (state.idToBody.has(descriptor.id)) return;
  if (!state.scene) return;

  createRemoteBody(state, descriptor, createMeshFromDescriptor(state, descriptor));
}

export function createRemoteBody(state: NetworkedPluginState, descriptor: BodyDescriptor, mesh: Mesh): void {
  const scene = state.scene!;

  mesh.metadata = { bodyId: descriptor.id };
  const motionType = motionTypeFromWire(descriptor.motionType);

  const physicsEngine = scene.getPhysicsEngine();
  if (physicsEngine) {
    state.remoteBodyCreationIds.add(descriptor.id);
    try {
      const body = new PhysicsBody(mesh, motionType, false, scene);

      const shape = createShapeFromDescriptor(state, descriptor, mesh);
      if (shape) {
        body.shape = shape;
      }

      state.bodyToId.set(body, descriptor.id);
      state.idToBody.set(descriptor.id, body);
      state.bodyIdToPhysicsBody.set(descriptor.id, body);
      state.remoteBodies.add(descriptor.id);
    } finally {
      state.remoteBodyCreationIds.delete(descriptor.id);
    }
  }
}

export function handleBodyRemoved(state: NetworkedPluginState, bodyId: string): void {
  const body = state.idToBody.get(bodyId);
  if (body) {
    const tn = body.transformNode;
    if (tn) {
      tn.dispose();
    }
    body.dispose();

    state.bodyToId.delete(body);
    state.idToBody.delete(bodyId);
    state.bodyIdToPhysicsBody.delete(bodyId);
    state.remoteBodies.delete(bodyId);
  }
}

/**
 * Resets all networked state and returns the list of bodies to dispose
 * via super.removeBody() in the class wrapper.
 */
export function handleSimulationStarted(
  state: NetworkedPluginState,
  _freshSnapshot: RoomSnapshot,
): PhysicsBody[] {
  const entries = Array.from(state.bodyToId.entries());
  state.bodyToId.clear();
  state.idToBody.clear();
  state.bodyIdToPhysicsBody.clear();
  state.pendingBodies.clear();
  state.remoteBodies.clear();
  state.geometryCache.clear();
  state.sentGeometryHashes.clear();
  state.materialCache.clear();
  state.textureCache.clear();
  state.sentMaterialHashes.clear();
  state.sentTextureHashes.clear();

  for (const [, url] of state.textureObjectUrls) {
    URL.revokeObjectURL(url);
  }
  state.textureObjectUrls.clear();
  state.collisionCount = 0;

  for (const [, joint] of state.remoteConstraintJoints) {
    state.world.removeImpulseJoint(joint, true);
  }
  state.remoteConstraintJoints.clear();
  state.constraintToNetId.clear();
  state.localConstraintIds.clear();

  const bodiesToRemove: PhysicsBody[] = [];
  for (const [body] of entries) {
    const tn = body.transformNode;
    if (tn) {
      tn.dispose();
    }
    bodiesToRemove.push(body);
  }

  for (const cb of state.simulationResetCallbacks) cb();

  return bodiesToRemove;
}

export function createMeshFromDescriptor(state: NetworkedPluginState, descriptor: BodyDescriptor): Mesh {
  const scene = state.scene!;
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

export function createShapeFromDescriptor(
  state: NetworkedPluginState,
  descriptor: BodyDescriptor,
  mesh: Mesh,
): PhysicsShape | null {
  const scene = state.scene!;

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
