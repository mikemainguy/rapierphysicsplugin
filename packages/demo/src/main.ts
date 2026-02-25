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
  VertexData,
  Mesh,
} from '@babylonjs/core';
import { RapierPlugin, PhysicsSyncClient } from '@rapierphysicsplugin/client';
import type { BodyDescriptor, BodyState, BoxShapeParams, CapsuleShapeParams, RoomSnapshot, SphereShapeParams } from '@rapierphysicsplugin/shared';

// Body ID → BabylonJS mesh
const meshMap = new Map<string, Mesh>();

// Colors for different shape types
const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
  ramp: new Color3(0.9, 0.6, 0.2),
};

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

    // Recreate from fresh snapshot
    createMeshesFromSnapshot(scene, freshSnapshot);
    simButton.textContent = 'Reset';
  });

  // 6c. Wire up onBodyAdded to create meshes for bodies added by any client
  syncClient.onBodyAdded((descriptor) => {
    if (!meshMap.has(descriptor.id)) {
      createMeshFromDescriptor(scene, descriptor);
    }
  });

  // 6d. Wire up Spawn button
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
      syncClient.addBody({
        id: `box-${ts}-${i}`,
        shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
        motionType: 'dynamic',
        position: randomPos(),
        rotation: identityRot,
        mass: 1,
        friction: 0.5,
        restitution: 0.3,
      });
    }
    for (let i = 0; i < numSpheres; i++) {
      syncClient.addBody({
        id: `sphere-${ts}-${i}`,
        shape: { type: 'sphere', params: { radius: 0.5 } },
        motionType: 'dynamic',
        position: randomPos(),
        rotation: identityRot,
        mass: 1,
        friction: 0.5,
        restitution: 0.3,
      });
    }
    for (let i = 0; i < numCapsules; i++) {
      syncClient.addBody({
        id: `capsule-${ts}-${i}`,
        shape: { type: 'capsule', params: { halfHeight: 0.5, radius: 0.3 } },
        motionType: 'dynamic',
        position: randomPos(),
        rotation: identityRot,
        mass: 1,
        friction: 0.5,
        restitution: 0.3,
      });
    }
  });

  // 7. Listen for state updates
  syncClient.onStateUpdate((state: RoomSnapshot) => {
    for (const body of state.bodies) {
      updateMesh(body);
    }

    // Update debug overlay
    const clockSync = syncClient.getClockSync();
    const rtt = clockSync.getRTT();
    const offset = clockSync.getClockOffset();
    const tick = state.tick;
    const fps = engine.getFps();
    const sent = syncClient.bytesSent;
    const recv = syncClient.bytesReceived;
    debugEl.textContent =
      `FPS: ${fps.toFixed(0)}\n` +
      `Tick: ${tick}\n` +
      `RTT: ${rtt.toFixed(1)} ms\n` +
      `Clock offset: ${offset.toFixed(1)} ms\n` +
      `Bodies: ${syncClient.totalBodyCount} (delta: ${state.bodies.length})\n` +
      `WS sent: ${formatBytes(sent)}\n` +
      `WS recv: ${formatBytes(recv)}\n` +
      `Client: ${syncClient.getClientId() ?? '?'}`;
  });

  // 8. Click to apply impulse (works on any dynamic body)
  scene.onPointerDown = (_evt, pickResult) => {
    if (pickResult?.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh as Mesh;
      const bodyId = mesh.metadata?.bodyId as string | undefined;
      if (bodyId && bodyId !== 'ground' && bodyId !== 'ramp') {
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

  // 9. Render loop
  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });
}

function createMeshesFromSnapshot(scene: Scene, snapshot: RoomSnapshot) {
  for (const body of snapshot.bodies) {
    if (body.id === 'ground') {
      createGroundMesh(scene, body);
    } else if (body.id.startsWith('box-')) {
      createBoxMesh(scene, body);
    } else if (body.id.startsWith('sphere-')) {
      createSphereMesh(scene, body);
    } else if (body.id.startsWith('capsule-')) {
      createCapsuleMesh(scene, body);
    } else if (body.id === 'ramp') {
      createRampMesh(scene, body);
    }
  }
}

function createGroundMesh(scene: Scene, body: BodyState) {
  const ground = MeshBuilder.CreateBox('ground', { width: 20, height: 1, depth: 20 }, scene);
  ground.position.set(body.position.x, body.position.y, body.position.z);
  ground.metadata = { bodyId: 'ground' };

  const mat = new StandardMaterial('groundMat', scene);
  mat.diffuseColor = new Color3(0.4, 0.4, 0.45);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  ground.material = mat;

  meshMap.set('ground', ground);
}

function createBoxMesh(scene: Scene, body: BodyState) {
  const box = MeshBuilder.CreateBox(body.id, { size: 1 }, scene);
  box.position.set(body.position.x, body.position.y, body.position.z);
  box.rotationQuaternion = new Quaternion(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
  box.metadata = { bodyId: body.id };

  const mat = new StandardMaterial(`${body.id}Mat`, scene);
  mat.diffuseColor = shapeColors.box;
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  box.material = mat;

  meshMap.set(body.id, box);
}

function createSphereMesh(scene: Scene, body: BodyState) {
  const sphere = MeshBuilder.CreateSphere(body.id, { diameter: 1 }, scene);
  sphere.position.set(body.position.x, body.position.y, body.position.z);
  sphere.rotationQuaternion = new Quaternion(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
  sphere.metadata = { bodyId: body.id };

  const mat = new StandardMaterial(`${body.id}Mat`, scene);
  mat.diffuseColor = shapeColors.sphere;
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  sphere.material = mat;

  meshMap.set(body.id, sphere);
}

function createCapsuleMesh(scene: Scene, body: BodyState) {
  // Rapier capsule(halfHeight=0.5, radius=0.3) → total height = 2*0.5 + 2*0.3 = 1.6
  const capsule = MeshBuilder.CreateCapsule(body.id, { height: 1.6, radius: 0.3 }, scene);
  capsule.position.set(body.position.x, body.position.y, body.position.z);
  capsule.rotationQuaternion = new Quaternion(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
  capsule.metadata = { bodyId: body.id };

  const mat = new StandardMaterial(`${body.id}Mat`, scene);
  mat.diffuseColor = shapeColors.capsule;
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  capsule.material = mat;

  meshMap.set(body.id, capsule);
}

function createRampMesh(scene: Scene, body: BodyState) {
  // Same geometry as the server-side trimesh collider (triangular wedge)
  const ramp = new Mesh(body.id, scene);
  const vertexData = new VertexData();

  const positions = [
    -1, 0, -1,   // v0: bottom front-left
     1, 0, -1,   // v1: bottom front-right
     1, 0,  1,   // v2: bottom back-right
    -1, 0,  1,   // v3: bottom back-left
    -1, 1.5, -1, // v4: top front-left
    -1, 1.5,  1, // v5: top back-left
  ];

  const indices = [
    0, 2, 1,  // bottom
    0, 3, 2,  // bottom
    0, 4, 5,  // left wall
    0, 5, 3,  // left wall
    0, 1, 4,  // front triangle
    3, 5, 2,  // back triangle
    4, 1, 2,  // slope
    4, 2, 5,  // slope
  ];

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(ramp);

  ramp.position.set(body.position.x, body.position.y, body.position.z);
  ramp.rotationQuaternion = new Quaternion(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
  ramp.metadata = { bodyId: body.id };

  const mat = new StandardMaterial(`${body.id}Mat`, scene);
  mat.diffuseColor = shapeColors.ramp;
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  ramp.material = mat;

  meshMap.set(body.id, ramp);
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
  mat.diffuseColor = shapeColors[colorKey] ?? new Color3(0.5, 0.5, 0.5);
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

function updateMesh(body: BodyState) {
  const mesh = meshMap.get(body.id);
  if (!mesh) return;

  mesh.position.set(body.position.x, body.position.y, body.position.z);

  if (!mesh.rotationQuaternion) {
    mesh.rotationQuaternion = new Quaternion();
  }
  mesh.rotationQuaternion.set(
    body.rotation.x,
    body.rotation.y,
    body.rotation.z,
    body.rotation.w,
  );
}

main();
