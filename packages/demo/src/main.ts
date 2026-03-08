import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  PhysicsAggregate,
  PhysicsShapeType,
  Mesh,
  BallAndSocketConstraint,
} from '@babylonjs/core';
import { NetworkedRapierPlugin } from '@rapierphysicsplugin/client';
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';

const gravity = new Vector3(0, -9.81, 0);

async function main() {
  // 1. Init Rapier WASM — read backend preference from URL query param
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get('backend') as ComputeBackend | null;
  const backend = backendParam ?? (detectSIMDSupport() ? ComputeBackend.WASM_SIMD : ComputeBackend.WASM_COMPAT);
  const RAPIER = await loadRapier({ backend });

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

  // 3. Create NetworkedRapierPlugin and connect
  const debugEl = document.getElementById('debug')!;

  let plugin: NetworkedRapierPlugin;
  try {
    debugEl.textContent = 'Connecting...';
    ({ plugin } = await NetworkedRapierPlugin.createAsync(
      RAPIER, gravity,
      { serverUrl: 'wss://rapier-server.flatearthdefense.com', roomId: 'demo' },
      scene,
    ));
    debugEl.textContent = 'Connected.';
  } catch {
    debugEl.textContent = 'Failed to connect to server';
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    return;
  }

  // 4. Create ground plane — standard BabylonJS physics, plugin handles networking
  function createGround() {
    const ground = MeshBuilder.CreateBox('ground', { width: 20, height: 1, depth: 20 }, scene);
    const mat = new StandardMaterial('groundMat', scene);
    mat.diffuseColor = new Color3(0.4, 0.4, 0.45);
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    ground.material = mat;
    ground.position.set(0, -0.5, 0);
    new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.3 }, scene);
  }
  let constraintCleanup: (() => void) | null = null;

  function createConstraints() {
    // Clean up existing constraint bodies
    if (constraintCleanup) {
      constraintCleanup();
      constraintCleanup = null;
    }

    const anchorMesh = MeshBuilder.CreateBox('static', { width: 1, height: 1, depth: 1 }, scene);
    const anchorMat = new StandardMaterial('staticMat', scene);
    anchorMat.diffuseColor = new Color3(0.4, 0.4, 1);
    anchorMat.specularColor = new Color3(0.3, 0.3, 1);
    anchorMesh.material = anchorMat;
    anchorMesh.position.set(0, 5, 0);
    const anchorAgg = new PhysicsAggregate(anchorMesh, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.3 }, scene);

    const swingMesh = MeshBuilder.CreateBox('constrained', { width: 1, height: 1, depth: 1 }, scene);
    const swingMat = new StandardMaterial('constrainedMat', scene);
    swingMat.diffuseColor = new Color3(1, 0.4, 0.4);
    swingMat.specularColor = new Color3(0.3, 0.3, 1);
    swingMesh.material = swingMat;
    swingMesh.position.set(3, 5, 0);
    const swingAgg = new PhysicsAggregate(swingMesh, PhysicsShapeType.BOX, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);

    const constraint = new BallAndSocketConstraint(
      new Vector3(0, 0, 0),
      new Vector3(-3, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(0, 1, 0),
      scene,
    );
    anchorAgg.body.addConstraint(swingAgg.body, constraint);

    constraintCleanup = () => {
      constraint.dispose();
      anchorAgg.dispose();
      anchorMesh.dispose();
      swingAgg.dispose();
      swingMesh.dispose();
    };
  }
  createGround();
  createConstraints();

  // 5. Start/Reset button
  const simButton = document.getElementById('simButton') as HTMLButtonElement;
  simButton.textContent = plugin.simulationRunning ? 'Reset' : 'Start';

  simButton.addEventListener('click', () => {
    plugin.startSimulation();
  });

  plugin.onSimulationReset(() => {
    createGround();
    createConstraints();
    simButton.textContent = 'Reset';
  });

  // 6. Spawn button — create meshes + PhysicsAggregates (plugin auto-sends to server)
  const spawnButton = document.getElementById('spawnButton') as HTMLButtonElement;
  const spawnBoxesInput = document.getElementById('spawnBoxes') as HTMLInputElement;
  const spawnSpheresInput = document.getElementById('spawnSpheres') as HTMLInputElement;
  const spawnCapsulesInput = document.getElementById('spawnCapsules') as HTMLInputElement;

  spawnButton.addEventListener('click', () => {
    const ts = Date.now();
    const numBoxes = Math.max(0, parseInt(spawnBoxesInput.value) || 0);
    const numSpheres = Math.max(0, parseInt(spawnSpheresInput.value) || 0);
    const numCapsules = Math.max(0, parseInt(spawnCapsulesInput.value) || 0);

    const randomPos = () => new Vector3(
      Math.random() * 10 - 5,
      Math.random() * 10 + 5,
      Math.random() * 10 - 5,
    );

    for (let i = 0; i < numBoxes; i++) {
      const id = `box-${ts}-${i}`;
      const mesh = MeshBuilder.CreateBox(id, { width: 1, height: 1, depth: 1 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(Math.random(), Math.random(), 0.2);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);
    }

    for (let i = 0; i < numSpheres; i++) {
      const id = `sphere-${ts}-${i}`;
      const mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.2, 0.7, 0.9);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);
    }

    for (let i = 0; i < numCapsules; i++) {
      const id = `capsule-${ts}-${i}`;
      const mesh = MeshBuilder.CreateCapsule(id, { height: 1.6, radius: 0.3 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.2, 0.9, 0.3);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      new PhysicsAggregate(mesh, PhysicsShapeType.CAPSULE, {
        mass: 1, friction: 0.5, restitution: 0.3,
        pointA: new Vector3(0, -0.5, 0),
        pointB: new Vector3(0, 0.5, 0),
        radius: 0.3,
      }, scene);
    }
  });

  // 7. Click to apply impulse (uses standard Babylon.js physics API)
  scene.onPointerDown = (_evt, pickResult) => {
    if (pickResult?.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh as Mesh;
      if (mesh.physicsBody) {
        const point = pickResult.pickedPoint ?? mesh.position;
        mesh.physicsBody.applyImpulse(new Vector3(0, 4, 0), point);
      }
    }
  };

  // 8. State update tracking for debug overlay
  let lastTick = 0;
  let lastDeltaCount = 0;
  plugin.onStateUpdate((state) => {
    lastTick = state.tick;
    lastDeltaCount = state.bodies.length;
  });

  // 9. Render loop — just scene.render() + debug overlay
  const reconciler = plugin.getReconciler();
  const interpolator = reconciler.getInterpolator();
  const clockSync = plugin.getClockSync();

  engine.runRenderLoop(() => {
    scene.render();

    // Update debug overlay
    const stats = interpolator.getStats();
    const rtt = clockSync.getRTT();
    const offset = clockSync.getClockOffset();
    const fps = engine.getFps();

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
      `Bodies: ${plugin.totalBodyCount} (delta: ${lastDeltaCount})\n` +
      `Interp: ${stats.interpolatedCount} extrap: ${stats.extrapolatedCount} stale: ${stats.staleCount} empty: ${stats.emptyCount}\n` +
      `RenderDelay: ${stats.renderDelay.toFixed(0)} ms\n` +
      `${sampleInfo}\n` +
      `WS sent: ${formatBytes(plugin.bytesSent)}\n` +
      `WS recv: ${formatBytes(plugin.bytesReceived)}\n` +
      `Collisions: ${plugin.collisionEventCount}\n` +
      `Client: ${plugin.getClientId() ?? '?'}`;
  });

  window.addEventListener('resize', () => engine.resize());
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

main();
