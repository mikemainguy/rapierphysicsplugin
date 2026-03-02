import RAPIER from '@dimforge/rapier3d-compat';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Quaternion,
  Mesh,
} from '@babylonjs/core';
import { SceneSerializer } from '@babylonjs/core/Misc/sceneSerializer';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import { RapierPlugin, PhysicsSyncClient } from '@rapierphysicsplugin/client';
import type { BodyDescriptor, BoxShapeParams, CapsuleShapeParams, RoomSnapshot, SphereShapeParams } from '@rapierphysicsplugin/shared';

// Body ID → BabylonJS mesh
const meshMap = new Map<string, Mesh>();

// Collision event counter
let collisionCount = 0;

// Colors for different shape types
const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
};

// Static body color (ground gray)
const staticColor = new Color3(0.4, 0.4, 0.45);

async function deserializeMesh(
  scene: Scene, meshData: object, bodyId: string,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
): Promise<Mesh> {
  const json = JSON.stringify(meshData);
  const result = await SceneLoader.ImportMeshAsync('', '', 'data:' + json, scene);
  const mesh = result.meshes[0] as Mesh;
  mesh.name = bodyId;
  mesh.id = bodyId;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotationQuaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  mesh.metadata = { bodyId };
  meshMap.set(bodyId, mesh);
  return mesh;
}

function createAndSendBody(
  scene: Scene, syncClient: PhysicsSyncClient, descriptor: BodyDescriptor,
  meshCreator: (scene: Scene) => Mesh,
) {
  const mesh = meshCreator(scene);
  mesh.metadata = { bodyId: descriptor.id };
  meshMap.set(descriptor.id, mesh);
  const meshData = SceneSerializer.SerializeMesh(mesh);
  syncClient.addBody({ ...descriptor, meshData });
}

async function main() {
  // 1. Init Rapier WASM
  await RAPIER.init();

  // 2. BabylonJS engine & scene
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 4, Math.PI / 3, 20, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 40;

  // Light
  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  // 3. Rapier physics plugin (local — used for BabylonJS physics API compatibility)
  const plugin = new RapierPlugin(RAPIER, new Vector3(0, -9.81, 0));
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);

  // 4. Connect to server
  const syncClient = new PhysicsSyncClient();
  const debugEl = document.getElementById('debug')!;

  try {
    await syncClient.connect('wss://rapier-server.flatearthdefense.com');
    debugEl.textContent = 'Connected. Joining room...';
  } catch {
    debugEl.textContent = 'Failed to connect to wss://rapier-server.flatearthdefense.com';
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    return;
  }

  // 5. Join room and get snapshot
  let snapshot: RoomSnapshot;
  try {
    snapshot = await syncClient.joinRoom('demo');
    debugEl.textContent = `Joined room. Bodies: ${snapshot.bodies.length}`;
  } catch {
    debugEl.textContent = 'Failed to join room "demo"';
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    return;
  }

  // 6. Create meshes from snapshot
  createMeshesFromSnapshot(scene, snapshot);

  // 6a. Auto-spawn ground plane (static box matching old server-side ground)
  createAndSendBody(scene, syncClient, {
    id: 'ground',
    shape: { type: 'box', params: { halfExtents: { x: 10, y: 0.5, z: 10 } } },
    motionType: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    friction: 0.8,
    restitution: 0.3,
  }, (s) => {
    const m = MeshBuilder.CreateBox('ground', { width: 20, height: 1, depth: 20 }, s);
    const mat = new StandardMaterial('groundMat', s);
    mat.diffuseColor = staticColor;
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    m.material = mat;
    m.position.set(0, -0.5, 0);
    return m;
  });

  // 6b. Wire up Start/Reset button
  const simButton = document.getElementById('simButton') as HTMLButtonElement;
  simButton.textContent = syncClient.simulationRunning ? 'Reset' : 'Start';

  simButton.addEventListener('click', () => {
    syncClient.startSimulation();
  });

  syncClient.onSimulationStarted((freshSnapshot) => {
    // Dispose all existing meshes
    for (const [, mesh] of meshMap) {
      mesh.dispose();
    }
    meshMap.clear();
    collisionCount = 0;

    // Recreate from fresh snapshot
    createMeshesFromSnapshot(scene, freshSnapshot);

    // Re-spawn ground after reset
    createAndSendBody(scene, syncClient, {
      id: 'ground',
      shape: { type: 'box', params: { halfExtents: { x: 10, y: 0.5, z: 10 } } },
      motionType: 'static',
      position: { x: 0, y: -0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      friction: 0.8,
      restitution: 0.3,
    }, (s) => {
      const m = MeshBuilder.CreateBox('ground', { width: 20, height: 1, depth: 20 }, s);
      const mat = new StandardMaterial('groundMat', s);
      mat.diffuseColor = staticColor;
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      m.material = mat;
      m.position.set(0, -0.5, 0);
      return m;
    });

    simButton.textContent = 'Reset';
  });

  // 6c. Wire up onBodyAdded to create meshes for bodies added by any client
  syncClient.onBodyAdded((descriptor) => {
    if (meshMap.has(descriptor.id)) return;
    if (descriptor.meshData) {
      deserializeMesh(scene, descriptor.meshData, descriptor.id,
        descriptor.position, descriptor.rotation);
    } else {
      createMeshFromDescriptor(scene, descriptor);
    }
  });

  // 6d. Wire up collision events
  syncClient.onCollisionEvents((events) => {
    collisionCount += events.length;
  });

  // 6e. Wire up Spawn button
  const spawnButton = document.getElementById('spawnButton') as HTMLButtonElement;
  const spawnBoxesInput = document.getElementById('spawnBoxes') as HTMLInputElement;
  const spawnSpheresInput = document.getElementById('spawnSpheres') as HTMLInputElement;
  const spawnCapsulesInput = document.getElementById('spawnCapsules') as HTMLInputElement;

  spawnButton.addEventListener('click', () => {
    const ts = Date.now();
    const numBoxes = Math.max(0, parseInt(spawnBoxesInput.value) || 0);
    const numSpheres = Math.max(0, parseInt(spawnSpheresInput.value) || 0);
    const numCapsules = Math.max(0, parseInt(spawnCapsulesInput.value) || 0);

    const randomPos = () => ({
      x: Math.random() * 10 - 5,
      y: Math.random() * 10 + 5,
      z: Math.random() * 10 - 5,
    });
    const identityRot = { x: 0, y: 0, z: 0, w: 1 };

    for (let i = 0; i < numBoxes; i++) {
      const id = `box-${ts}-${i}`;
      const pos = randomPos();
      createAndSendBody(scene, syncClient, {
        id, shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
        motionType: 'dynamic', position: pos, rotation: identityRot,
        mass: 1, friction: 0.5, restitution: 0.3,
      }, (s) => {
        const m = MeshBuilder.CreateBox(id, { width: 1, height: 1, depth: 1 }, s);
        const mat = new StandardMaterial(`${id}Mat`, s);
        mat.diffuseColor = shapeColors.box;
        mat.specularColor = new Color3(0.3, 0.3, 0.3);
        m.material = mat;
        m.position.set(pos.x, pos.y, pos.z);
        return m;
      });
    }
    for (let i = 0; i < numSpheres; i++) {
      const id = `sphere-${ts}-${i}`;
      const pos = randomPos();
      createAndSendBody(scene, syncClient, {
        id, shape: { type: 'sphere', params: { radius: 0.5 } },
        motionType: 'dynamic', position: pos, rotation: identityRot,
        mass: 1, friction: 0.5, restitution: 0.3,
      }, (s) => {
        const m = MeshBuilder.CreateSphere(id, { diameter: 1 }, s);
        const mat = new StandardMaterial(`${id}Mat`, s);
        mat.diffuseColor = shapeColors.sphere;
        mat.specularColor = new Color3(0.3, 0.3, 0.3);
        m.material = mat;
        m.position.set(pos.x, pos.y, pos.z);
        return m;
      });
    }
    for (let i = 0; i < numCapsules; i++) {
      const id = `capsule-${ts}-${i}`;
      const pos = randomPos();
      createAndSendBody(scene, syncClient, {
        id, shape: { type: 'capsule', params: { halfHeight: 0.5, radius: 0.3 } },
        motionType: 'dynamic', position: pos, rotation: identityRot,
        mass: 1, friction: 0.5, restitution: 0.3,
      }, (s) => {
        const m = MeshBuilder.CreateCapsule(id, { height: 1.6, radius: 0.3 }, s);
        const mat = new StandardMaterial(`${id}Mat`, s);
        mat.diffuseColor = shapeColors.capsule;
        mat.specularColor = new Color3(0.3, 0.3, 0.3);
        m.material = mat;
        m.position.set(pos.x, pos.y, pos.z);
        return m;
      });
    }
  });

  // 7. Listen for state updates (feed interpolator + bookkeeping only, no mesh updates)
  let lastTick = 0;
  let lastDeltaCount = 0;
  syncClient.onStateUpdate((state: RoomSnapshot) => {
    lastTick = state.tick;
    lastDeltaCount = state.bodies.length;
  });

  // 8. Click to apply impulse (works on any dynamic body)
  scene.onPointerDown = (_evt, pickResult) => {
    if (pickResult?.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh as Mesh;
      const bodyId = mesh.metadata?.bodyId as string | undefined;
      if (bodyId && bodyId !== 'ground') {
        const point = pickResult.pickedPoint;
        syncClient.sendInput([
          {
            type: 'applyImpulse',
            bodyId,
            data: {
              impulse: { x: 0, y: 8, z: 0 },
              point: point ? { x: point.x, y: point.y, z: point.z } : undefined,
            },
          },
        ]);
      }
    }
  };

  // 9. Render loop — query interpolator at 60Hz for smooth mesh updates
  const reconciler = syncClient.getReconciler();
  const interpolator = reconciler.getInterpolator();
  const clockSync = syncClient.getClockSync();

  engine.runRenderLoop(() => {
    const serverTime = clockSync.getServerTime();

    // Reset per-frame stats before querying
    interpolator.resetStats();

    // Update meshes from interpolator
    for (const [bodyId, mesh] of meshMap) {
      const interpolated = reconciler.getInterpolatedRemoteState(bodyId, serverTime);
      if (interpolated) {
        mesh.position.set(interpolated.position.x, interpolated.position.y, interpolated.position.z);
        if (!mesh.rotationQuaternion) {
          mesh.rotationQuaternion = new Quaternion();
        }
        mesh.rotationQuaternion.set(
          interpolated.rotation.x,
          interpolated.rotation.y,
          interpolated.rotation.z,
          interpolated.rotation.w,
        );
      }
      // If null (e.g. static body with no updates), mesh keeps its initial position
    }

    scene.render();

    // Update debug overlay with interpolation diagnostics
    const stats = interpolator.getStats();
    const rtt = clockSync.getRTT();
    const offset = clockSync.getClockOffset();
    const fps = engine.getFps();
    const sent = syncClient.bytesSent;
    const recv = syncClient.bytesReceived;

    let sampleInfo = '';
    if (stats.sampleBodyId) {
      const gap = stats.sampleRenderTime - stats.sampleBufferNewest;
      sampleInfo =
        `  buf[${stats.sampleBufferLen}] t=${stats.sampleT.toFixed(3)}\n` +
        `  renderGap: ${gap.toFixed(0)} ms`;
    }

    debugEl.textContent =
      `FPS: ${fps.toFixed(0)}\n` +
      `Tick: ${lastTick}\n` +
      `RTT: ${rtt.toFixed(1)} ms\n` +
      `Clock offset: ${offset.toFixed(1)} ms\n` +
      `Bodies: ${syncClient.totalBodyCount} (delta: ${lastDeltaCount})\n` +
      `Interp: ${stats.interpolatedCount} extrap: ${stats.extrapolatedCount} stale: ${stats.staleCount} empty: ${stats.emptyCount}\n` +
      `RenderDelay: ${stats.renderDelay.toFixed(0)} ms\n` +
      `${sampleInfo}\n` +
      `WS sent: ${formatBytes(sent)}\n` +
      `WS recv: ${formatBytes(recv)}\n` +
      `Collisions: ${collisionCount}\n` +
      `Client: ${syncClient.getClientId() ?? '?'}`;
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });
}

function createMeshesFromSnapshot(_scene: Scene, _snapshot: RoomSnapshot) {
  // Snapshot only contains BodyState (position/rotation/velocity), not shape descriptors.
  // Meshes are created via onBodyAdded when BODY_ADDED messages arrive from the server.
}

function createMeshFromDescriptor(scene: Scene, descriptor: BodyDescriptor): Mesh {
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
      // Fallback for mesh shape type or unknown — render as unit box
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
  mesh.metadata = { bodyId: descriptor.id };

  const mat = new StandardMaterial(`${descriptor.id}Mat`, scene);
  // Use ground gray for static bodies, shape color for dynamic
  if (descriptor.motionType === 'static') {
    mat.diffuseColor = staticColor;
  } else {
    mat.diffuseColor = shapeColors[colorKey] ?? new Color3(0.5, 0.5, 0.5);
  }
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  mesh.material = mat;

  meshMap.set(descriptor.id, mesh);
  return mesh;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

main();
