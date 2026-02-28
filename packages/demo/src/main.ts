import RAPIER from '@dimforge/rapier3d-compat';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Matrix,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Quaternion,
  VertexData,
  Viewport,
  Mesh,
} from '@babylonjs/core';
import { RapierPlugin, PhysicsSyncClient } from '@rapierphysicsplugin/client';
import type { BodyDescriptor, BodyState, BoxShapeParams, CapsuleShapeParams, ConstraintDescriptor, RoomSnapshot, SphereShapeParams } from '@rapierphysicsplugin/shared';

// Body ID → BabylonJS mesh
const meshMap = new Map<string, Mesh>();

// Unified constraint visualization
interface ConstraintVizEntry {
  descriptor: ConstraintDescriptor;
  line: Mesh;
  label: HTMLDivElement;
  labelPos: Vector3;
  pivotMarkerA: Mesh;
  pivotMarkerB: Mesh;
  axisLine: Mesh | null;
  axisCone: Mesh | null;
}
const constraintViz = new Map<string, ConstraintVizEntry>();
let constraintDebugVisible = true;

// Shared materials for pivot markers (created lazily)
let pivotMatA: StandardMaterial | null = null;
let pivotMatB: StandardMaterial | null = null;
let axisLineMat: StandardMaterial | null = null;

function getPivotMaterials(scene: Scene) {
  if (!pivotMatA) {
    pivotMatA = new StandardMaterial('pivotMatA', scene);
    pivotMatA.emissiveColor = new Color3(1, 1, 0); // yellow
    pivotMatA.disableLighting = true;
  }
  if (!pivotMatB) {
    pivotMatB = new StandardMaterial('pivotMatB', scene);
    pivotMatB.emissiveColor = new Color3(0, 1, 1); // cyan
    pivotMatB.disableLighting = true;
  }
  if (!axisLineMat) {
    axisLineMat = new StandardMaterial('axisLineMat', scene);
    axisLineMat.emissiveColor = new Color3(1, 0.5, 0);
    axisLineMat.disableLighting = true;
  }
  return { pivotMatA, pivotMatB, axisLineMat };
}

// Colors for different shape types
const shapeColors: Record<string, Color3> = {
  box: new Color3(0.9, 0.2, 0.2),
  sphere: new Color3(0.2, 0.7, 0.9),
  capsule: new Color3(0.2, 0.9, 0.3),
  ramp: new Color3(0.9, 0.6, 0.2),
  anchor: new Color3(0.7, 0.7, 0.7),
  pendulum: new Color3(0.95, 0.8, 0.2),
  hinge: new Color3(0.8, 0.4, 0.9),
  rope: new Color3(0.2, 0.9, 0.8),
  slider: new Color3(0.9, 0.5, 0.2),
  lock: new Color3(0.6, 0.9, 0.4),
  spring: new Color3(0.9, 0.3, 0.6),
  '6dof': new Color3(0.4, 0.5, 0.95),
};

// Constraint type → line color
const constraintColors: Record<string, Color3> = {
  ball_and_socket: new Color3(0.95, 0.8, 0.2),
  hinge: new Color3(0.8, 0.4, 0.9),
  distance: new Color3(0.2, 0.9, 0.8),
  prismatic: new Color3(0.9, 0.5, 0.2),
  lock: new Color3(0.6, 0.9, 0.4),
  spring: new Color3(0.9, 0.3, 0.6),
  six_dof: new Color3(0.4, 0.5, 0.95),
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
    // Dispose all existing meshes and constraint viz
    for (const [, mesh] of meshMap) {
      mesh.dispose();
    }
    meshMap.clear();
    disposeAllConstraintViz();

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

  // 6d. Wire up constraint events — draw lines, labels, pivot markers, axis arrows
  syncClient.onConstraintAdded((constraint) => {
    createConstraintViz(scene, constraint);
  });

  syncClient.onConstraintRemoved((constraintId) => {
    const entry = constraintViz.get(constraintId);
    if (entry) {
      disposeConstraintVizEntry(entry);
      constraintViz.delete(constraintId);
    }
  });

  // 6f. Wire up constraint debug toggle
  const debugCheckbox = document.getElementById('constraintDebugCheck') as HTMLInputElement;
  debugCheckbox.addEventListener('change', () => {
    setConstraintDebugVisibility(debugCheckbox.checked);
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

    // Update constraint visualization (lines, pivots, axes)
    updateConstraintViz();

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
    updateConstraintLabels(scene, engine);
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
    } else if (body.id.startsWith('anchor-') || body.id.startsWith('pendulum-') ||
               body.id.startsWith('hinge-') || body.id.startsWith('rope-') ||
               body.id.startsWith('slider-') || body.id.startsWith('lock-') ||
               body.id.startsWith('spring-') || body.id.startsWith('6dof-')) {
      createConstraintDemoMesh(scene, body);
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

function getConstraintDemoColor(id: string): Color3 {
  if (id.startsWith('anchor-')) return shapeColors.anchor;
  if (id.startsWith('pendulum-')) return shapeColors.pendulum;
  if (id.startsWith('hinge-')) return shapeColors.hinge;
  if (id.startsWith('rope-')) return shapeColors.rope;
  if (id.startsWith('slider-')) return shapeColors.slider;
  if (id.startsWith('lock-')) return shapeColors.lock;
  if (id.startsWith('spring-')) return shapeColors.spring;
  if (id.startsWith('6dof-')) return shapeColors['6dof'];
  return new Color3(0.5, 0.5, 0.5);
}

function createConstraintDemoMesh(scene: Scene, body: BodyState) {
  // Determine shape from body ID conventions set in start-server.ts
  // Anchors and small items are spheres/boxes, doors are boxes, etc.
  // We reconstruct approximate visuals based on the known demo layout
  let mesh: Mesh;

  if (body.id === 'anchor-pendulum' || body.id === 'anchor-spring') {
    mesh = MeshBuilder.CreateSphere(body.id, { diameter: 0.3 }, scene);
  } else if (body.id === 'pendulum-ball' || body.id === 'spring-ball') {
    mesh = MeshBuilder.CreateSphere(body.id, { diameter: 0.8 }, scene);
  } else if (body.id === 'rope-top' || body.id === 'rope-bottom') {
    mesh = MeshBuilder.CreateSphere(body.id, { diameter: 0.6 }, scene);
  } else if (body.id === 'anchor-hinge') {
    mesh = MeshBuilder.CreateBox(body.id, { width: 0.2, height: 2, depth: 0.2 }, scene);
  } else if (body.id === 'hinge-door') {
    mesh = MeshBuilder.CreateBox(body.id, { width: 2.0, height: 1.6, depth: 0.16 }, scene);
  } else if (body.id === 'anchor-slider' || body.id === 'anchor-6dof') {
    mesh = MeshBuilder.CreateBox(body.id, { size: 0.3 }, scene);
  } else if (body.id === 'slider-box') {
    mesh = MeshBuilder.CreateBox(body.id, { size: 0.7 }, scene);
  } else if (body.id === 'lock-a' || body.id === 'lock-b') {
    mesh = MeshBuilder.CreateBox(body.id, { size: 0.8 }, scene);
  } else if (body.id === '6dof-box') {
    mesh = MeshBuilder.CreateBox(body.id, { width: 1.0, height: 0.6, depth: 1.0 }, scene);
  } else {
    mesh = MeshBuilder.CreateBox(body.id, { size: 0.5 }, scene);
  }

  mesh.position.set(body.position.x, body.position.y, body.position.z);
  mesh.rotationQuaternion = new Quaternion(
    body.rotation.x, body.rotation.y, body.rotation.z, body.rotation.w,
  );
  mesh.metadata = { bodyId: body.id };

  const mat = new StandardMaterial(`${body.id}Mat`, scene);
  mat.diffuseColor = getConstraintDemoColor(body.id);
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  mesh.material = mat;

  meshMap.set(body.id, mesh);
}

// --- Constraint viz helpers ---

function fmtVec3(v: { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)})`;
}

function fmtNum(n: number | undefined, fallback = '—'): string {
  return n !== undefined ? n.toFixed(2) : fallback;
}

const constraintTypeLabels: Record<string, string> = {
  ball_and_socket: 'Ball & Socket',
  hinge: 'Hinge',
  distance: 'Distance (Rope)',
  prismatic: 'Prismatic (Slider)',
  lock: 'Lock (Fixed)',
  spring: 'Spring',
  six_dof: '6-DOF',
};

const sixDofAxisNames = ['X', 'Y', 'Z', 'AngX', 'AngY', 'AngZ'];

function buildConstraintDetails(c: ConstraintDescriptor): string {
  const lines: string[] = [constraintTypeLabels[c.type] ?? c.type];

  switch (c.type) {
    case 'ball_and_socket':
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'hinge':
      if (c.axisA) lines.push(`axis ${fmtVec3(c.axisA)}`);
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'distance':
      lines.push(`maxDist ${fmtNum(c.maxDistance)}`);
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'prismatic':
    case 'slider':
      if (c.axisA) lines.push(`axis ${fmtVec3(c.axisA)}`);
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'lock':
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'spring':
      lines.push(`stiff ${fmtNum(c.stiffness)}  damp ${fmtNum(c.damping)}`);
      lines.push(`rest ${fmtNum(c.maxDistance)}`);
      if (c.pivotA) lines.push(`pivA ${fmtVec3(c.pivotA)}`);
      if (c.pivotB) lines.push(`pivB ${fmtVec3(c.pivotB)}`);
      break;
    case 'six_dof': {
      if (c.axisA) lines.push(`axis ${fmtVec3(c.axisA)}`);
      const limitMap = new Map((c.limits ?? []).map(l => [l.axis, l]));
      for (let i = 0; i < 6; i++) {
        const lim = limitMap.get(i);
        if (!lim) {
          lines.push(`${sixDofAxisNames[i]}: locked`);
        } else if (lim.minLimit === undefined && lim.maxLimit === undefined) {
          lines.push(`${sixDofAxisNames[i]}: free`);
        } else {
          const lo = lim.minLimit !== undefined ? lim.minLimit.toFixed(1) : '-∞';
          const hi = lim.maxLimit !== undefined ? lim.maxLimit.toFixed(1) : '∞';
          lines.push(`${sixDofAxisNames[i]}: [${lo},${hi}]`);
        }
      }
      break;
    }
  }

  return lines.join('\n');
}

const _tmpVec = new Vector3();

function localToWorld(bodyMesh: Mesh, localPivot: { x: number; y: number; z: number }): Vector3 {
  _tmpVec.set(localPivot.x, localPivot.y, localPivot.z);
  const q = bodyMesh.rotationQuaternion ?? Quaternion.Identity();
  const rotated = new Vector3();
  _tmpVec.rotateByQuaternionToRef(q, rotated);
  rotated.addInPlace(bodyMesh.position);
  return rotated;
}

function hasAxisViz(type: string): boolean {
  return type === 'hinge' || type === 'prismatic' || type === 'slider' || type === 'six_dof';
}

function createConstraintViz(scene: Scene, constraint: ConstraintDescriptor) {
  const meshA = meshMap.get(constraint.bodyIdA);
  const meshB = meshMap.get(constraint.bodyIdB);
  if (!meshA || !meshB) return;

  const mats = getPivotMaterials(scene);
  const pivotA = constraint.pivotA ?? { x: 0, y: 0, z: 0 };
  const pivotB = constraint.pivotB ?? { x: 0, y: 0, z: 0 };

  const worldA = localToWorld(meshA, pivotA);
  const worldB = localToWorld(meshB, pivotB);

  // Colored line between pivot points
  const points = [worldA.clone(), worldB.clone()];
  const line = MeshBuilder.CreateLines(`cline-${constraint.id}`, { points, updatable: true }, scene);
  const color = constraintColors[constraint.type] ?? new Color3(1, 1, 1);
  line.color = color;

  // Pivot marker spheres
  const pivotMarkerA = MeshBuilder.CreateSphere(`cpivA-${constraint.id}`, { diameter: 0.15, segments: 8 }, scene);
  pivotMarkerA.material = mats.pivotMatA;
  pivotMarkerA.position.copyFrom(worldA);

  const pivotMarkerB = MeshBuilder.CreateSphere(`cpivB-${constraint.id}`, { diameter: 0.15, segments: 8 }, scene);
  pivotMarkerB.material = mats.pivotMatB;
  pivotMarkerB.position.copyFrom(worldB);

  // Axis line + cone for hinge/prismatic/6dof
  let axisLine: Mesh | null = null;
  let axisCone: Mesh | null = null;
  if (hasAxisViz(constraint.type) && constraint.axisA) {
    const axisEnd = worldA.add(new Vector3(constraint.axisA.x, constraint.axisA.y, constraint.axisA.z).scale(1.5));
    const axisPoints = [worldA.clone(), axisEnd.clone()];
    axisLine = MeshBuilder.CreateLines(`caxis-${constraint.id}`, { points: axisPoints, updatable: true }, scene);
    (axisLine as any).color = new Color3(1, 0.5, 0); // orange

    axisCone = MeshBuilder.CreateCylinder(`ccone-${constraint.id}`, {
      diameterTop: 0,
      diameterBottom: 0.12,
      height: 0.2,
      tessellation: 8,
    }, scene);
    axisCone.material = mats.axisLineMat;
    axisCone.position.copyFrom(axisEnd);
    // Orient cone along axis direction
    const axDir = new Vector3(constraint.axisA.x, constraint.axisA.y, constraint.axisA.z).normalize();
    const up = new Vector3(0, 1, 0);
    if (Math.abs(Vector3.Dot(axDir, up)) > 0.99) {
      up.set(1, 0, 0);
    }
    const rotQ = Quaternion.Identity();
    Quaternion.FromLookDirectionLHToRef(axDir, up, rotQ);
    // Rotate 90 deg around X so the cone tip points along axDir
    const tilt = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
    rotQ.multiplyInPlace(tilt);
    axisCone.rotationQuaternion = rotQ;
  }

  // HTML label
  const el = document.createElement('div');
  el.className = 'constraint-label';
  el.textContent = buildConstraintDetails(constraint);
  const labelColor = constraintColors[constraint.type];
  if (labelColor) {
    el.style.borderBottom = `2px solid rgb(${labelColor.r * 255 | 0},${labelColor.g * 255 | 0},${labelColor.b * 255 | 0})`;
  }
  document.body.appendChild(el);

  const labelPos = Vector3.Center(worldA, worldB);
  labelPos.y += 1.0;

  const entry: ConstraintVizEntry = {
    descriptor: constraint,
    line,
    label: el,
    labelPos,
    pivotMarkerA,
    pivotMarkerB,
    axisLine,
    axisCone,
  };

  constraintViz.set(constraint.id, entry);

  // Respect current visibility state
  if (!constraintDebugVisible) {
    setEntryVisibility(entry, false);
  }
}

function updateConstraintViz() {
  for (const [, entry] of constraintViz) {
    const meshA = meshMap.get(entry.descriptor.bodyIdA);
    const meshB = meshMap.get(entry.descriptor.bodyIdB);
    if (!meshA || !meshB) continue;

    const pivotA = entry.descriptor.pivotA ?? { x: 0, y: 0, z: 0 };
    const pivotB = entry.descriptor.pivotB ?? { x: 0, y: 0, z: 0 };

    const worldA = localToWorld(meshA, pivotA);
    const worldB = localToWorld(meshB, pivotB);

    // Update line endpoints
    const points = [worldA.clone(), worldB.clone()];
    MeshBuilder.CreateLines(entry.line.name, { points, updatable: true, instance: entry.line as any }, null as any);

    // Update pivot markers
    entry.pivotMarkerA.position.copyFrom(worldA);
    entry.pivotMarkerB.position.copyFrom(worldB);

    // Update axis line + cone
    if (entry.axisLine && entry.descriptor.axisA) {
      const axisLocal = new Vector3(entry.descriptor.axisA.x, entry.descriptor.axisA.y, entry.descriptor.axisA.z);
      const q = meshA.rotationQuaternion ?? Quaternion.Identity();
      const axisWorld = new Vector3();
      axisLocal.rotateByQuaternionToRef(q, axisWorld);
      axisWorld.normalize();

      const axisEnd = worldA.add(axisWorld.scale(1.5));
      const axisPoints = [worldA.clone(), axisEnd.clone()];
      MeshBuilder.CreateLines(entry.axisLine.name, { points: axisPoints, updatable: true, instance: entry.axisLine as any }, null as any);

      if (entry.axisCone) {
        entry.axisCone.position.copyFrom(axisEnd);
        const up = new Vector3(0, 1, 0);
        if (Math.abs(Vector3.Dot(axisWorld, up)) > 0.99) {
          up.set(1, 0, 0);
        }
        const rotQ = Quaternion.Identity();
        Quaternion.FromLookDirectionLHToRef(axisWorld, up, rotQ);
        const tilt = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
        rotQ.multiplyInPlace(tilt);
        if (!entry.axisCone.rotationQuaternion) {
          entry.axisCone.rotationQuaternion = rotQ;
        } else {
          entry.axisCone.rotationQuaternion.copyFrom(rotQ);
        }
      }
    }

    // Update label position
    entry.labelPos = Vector3.Center(worldA, worldB);
    entry.labelPos.y += 1.0;
  }
}

function updateConstraintLabels(scene: Scene, engine: Engine) {
  if (!constraintDebugVisible) return;

  const vp = new Viewport(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
  const worldMatrix = Matrix.Identity();
  const vpMatrix = scene.getTransformMatrix();

  for (const [, entry] of constraintViz) {
    const projected = Vector3.Project(entry.labelPos, worldMatrix, vpMatrix, vp);

    if (projected.z < 0 || projected.z > 1) {
      entry.label.style.display = 'none';
    } else {
      entry.label.style.display = '';
      entry.label.style.left = `${projected.x}px`;
      entry.label.style.top = `${projected.y}px`;
    }
  }
}

function setEntryVisibility(entry: ConstraintVizEntry, visible: boolean) {
  entry.line.isVisible = visible;
  entry.pivotMarkerA.isVisible = visible;
  entry.pivotMarkerB.isVisible = visible;
  if (entry.axisLine) entry.axisLine.isVisible = visible;
  if (entry.axisCone) entry.axisCone.isVisible = visible;
  entry.label.style.display = visible ? '' : 'none';
}

function setConstraintDebugVisibility(visible: boolean) {
  constraintDebugVisible = visible;
  for (const [, entry] of constraintViz) {
    setEntryVisibility(entry, visible);
  }
}

function disposeConstraintVizEntry(entry: ConstraintVizEntry) {
  entry.line.dispose();
  entry.pivotMarkerA.dispose();
  entry.pivotMarkerB.dispose();
  if (entry.axisLine) entry.axisLine.dispose();
  if (entry.axisCone) entry.axisCone.dispose();
  entry.label.remove();
}

function disposeAllConstraintViz() {
  for (const [, entry] of constraintViz) {
    disposeConstraintVizEntry(entry);
  }
  constraintViz.clear();
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
