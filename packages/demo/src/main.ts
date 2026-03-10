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
  PhysicsEventType,
  Mesh,
  BallAndSocketConstraint,
  VertexBuffer,
} from '@babylonjs/core';
import type { IPhysicsCollisionEvent } from '@babylonjs/core';
import { NetworkedRapierPlugin } from '@rapierphysicsplugin/client';
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';
import type { ShapeDescriptor } from '@rapierphysicsplugin/shared';
import '@babylonjs/inspector';

const gravity = new Vector3(0, -9.81, 0);
const FLASH_COLOR = new Color3(1, 1, 0.2);
const FLASH_DURATION_MS = 150;

/** Briefly flash a mesh's diffuse color on collision */
function flashMeshOnCollision(mesh: Mesh): void {
  const mat = mesh.material as StandardMaterial | null;
  if (!mat) return;
  const originalColor = mat.diffuseColor.clone();
  mat.diffuseColor = FLASH_COLOR;
  setTimeout(() => {
    try { mat.diffuseColor = originalColor; } catch { /* disposed */ }
  }, FLASH_DURATION_MS);
}

/** Enable Babylon collision observables on a physics body with visual feedback */
function enableCollisionFlash(agg: PhysicsAggregate, mesh: Mesh): void {
  const body = agg.body;
  body.setCollisionCallbackEnabled(true);
  body.setCollisionEndedCallbackEnabled(true);
  body.getCollisionObservable().add((event: IPhysicsCollisionEvent) => {
    if (event.type === PhysicsEventType.COLLISION_STARTED) {
      flashMeshOnCollision(mesh);
    }
  });
}

async function main() {
  // 1. Init Rapier WASM — read backend preference from URL query param
  const params = new URLSearchParams(window.location.search);
  const backendParam = params.get('backend') as ComputeBackend | null;
  const backend = backendParam ?? (detectSIMDSupport() ? ComputeBackend.WASM_SIMD : ComputeBackend.WASM_COMPAT);
  const RAPIER = await loadRapier({ backend });

  // 2. BabylonJS engine & scene
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
  let snapshot: import('@rapierphysicsplugin/shared').RoomSnapshot;
  try {
    debugEl.textContent = 'Connecting...';
    ({ plugin, snapshot } = await NetworkedRapierPlugin.createAsync(
      RAPIER, gravity,
      { serverUrl: 'ws://localhost:8080', roomId: 'demo', renderDelayMs: 300, clockSyncIntervalMs: 2000 },
      scene,
    ));
    debugEl.textContent = 'Connected.';
  } catch {
    debugEl.textContent = 'Failed to connect to server';
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    return;
  }

  // 4. Create heightfield ground with hills and raised edges
  function createGround() {
    const subdivisions = 32;
    const groundSize = 20;
    const ground = MeshBuilder.CreateGround('ground', {
      width: groundSize,
      height: groundSize,
      subdivisions,
      updatable: true,
    }, scene);

    // Sculpt the vertex heights: raised edges + gentle hills
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      const edgeHeight = 2.0;
      const edgeFalloff = 0.15; // fraction of half-size for the rim ramp
      const halfSize = groundSize / 2;

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];

        // Gentle rolling hills using overlapping sine waves
        let y = 0;
        y += 0.3 * Math.sin(x * 0.8) * Math.cos(z * 0.6);
        y += 0.2 * Math.sin(x * 1.5 + 1.0) * Math.sin(z * 1.2 + 0.5);
        y += 0.15 * Math.cos(x * 0.4 + z * 0.7);

        // Raised edges — smooth ramp up near the boundary
        const dx = Math.abs(x) / halfSize; // 0 at center, 1 at edge
        const dz = Math.abs(z) / halfSize;
        const edgeX = Math.max(0, (dx - (1 - edgeFalloff)) / edgeFalloff); // 0→1 ramp
        const edgeZ = Math.max(0, (dz - (1 - edgeFalloff)) / edgeFalloff);
        const edgeFactor = Math.max(edgeX, edgeZ);
        y += edgeHeight * edgeFactor * edgeFactor; // quadratic ramp

        positions[i + 1] = y;
      }

      ground.updateVerticesData(VertexBuffer.PositionKind, positions);
      ground.createNormals(true);
    }

    const mat = new StandardMaterial('groundMat', scene);
    mat.diffuseColor = new Color3(0.35, 0.5, 0.3);
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    ground.material = mat;

    new PhysicsAggregate(ground, PhysicsShapeType.HEIGHTFIELD, {
      mass: 0,
      friction: 0.8,
      restitution: 0.3,
      groundMesh: ground,
    } as any, scene);
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
  // Only create scene bodies if they don't already exist on the server
  const knownIds = new Set(snapshot.bodies.map(b => b.id));
  if (!knownIds.has('ground')) createGround();
  if (!knownIds.has('static')) createConstraints();

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
  const spawnCylindersInput = document.getElementById('spawnCylinders') as HTMLInputElement;
  const spawnConesInput = document.getElementById('spawnCones') as HTMLInputElement;

  spawnButton.addEventListener('click', () => {
    const ts = Date.now();
    const numBoxes = Math.max(0, parseInt(spawnBoxesInput.value) || 0);
    const numSpheres = Math.max(0, parseInt(spawnSpheresInput.value) || 0);
    const numCapsules = Math.max(0, parseInt(spawnCapsulesInput.value) || 0);
    const numCylinders = Math.max(0, parseInt(spawnCylindersInput.value) || 0);
    const numCones = Math.max(0, parseInt(spawnConesInput.value) || 0);

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
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);
      enableCollisionFlash(agg, mesh);
    }

    for (let i = 0; i < numSpheres; i++) {
      const id = `sphere-${ts}-${i}`;
      const mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.2, 0.7, 0.9);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);
      enableCollisionFlash(agg, mesh);
    }

    for (let i = 0; i < numCapsules; i++) {
      const id = `capsule-${ts}-${i}`;
      const mesh = MeshBuilder.CreateCapsule(id, { height: 1.6, radius: 0.3 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.2, 0.9, 0.3);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.CAPSULE, {
        mass: 1, friction: 0.5, restitution: 0.3,
        pointA: new Vector3(0, -0.5, 0),
        pointB: new Vector3(0, 0.5, 0),
        radius: 0.3,
      }, scene);
      enableCollisionFlash(agg, mesh);
    }

    for (let i = 0; i < numCylinders; i++) {
      const id = `cylinder-${ts}-${i}`;
      const mesh = MeshBuilder.CreateCylinder(id, { height: 1.2, diameter: 0.8 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.9, 0.6, 0.1);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.CYLINDER, {
        mass: 1, friction: 0.5, restitution: 0.3,
        pointA: new Vector3(0, -0.6, 0),
        pointB: new Vector3(0, 0.6, 0),
        radius: 0.4,
      }, scene);
      enableCollisionFlash(agg, mesh);
    }

    for (let i = 0; i < numCones; i++) {
      const id = `cone-${ts}-${i}`;
      const mesh = MeshBuilder.CreateCylinder(id, { height: 1.2, diameterTop: 0, diameterBottom: 0.8, tessellation: 16 }, scene);
      const mat = new StandardMaterial(`${id}Mat`, scene);
      mat.diffuseColor = new Color3(0.8, 0.2, 0.8);
      mat.specularColor = new Color3(0.3, 0.3, 0.3);
      mesh.material = mat;
      mesh.position = randomPos();
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.CONVEX_HULL, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);
      enableCollisionFlash(agg, mesh);
    }
  });

  // 7. Click to apply impulse (left-click) or remove body (right-click)
  const PROTECTED_NAMES = new Set(['ground', 'static', 'constrained']);

  scene.onPointerDown = (evt, pickResult) => {
    if (!pickResult?.hit || !pickResult.pickedMesh) return;
    const mesh = pickResult.pickedMesh as Mesh;
    if (!mesh.physicsBody) return;

    if (evt.button === 0) {
      // Left-click: apply impulse
      const point = pickResult.pickedPoint ?? mesh.position;
      mesh.physicsBody.applyImpulse(new Vector3(0, 4, 0), point);
    } else if (evt.button === 2) {
      // Right-click: remove body (skip protected)
      if (PROTECTED_NAMES.has(mesh.name)) return;
      mesh.physicsBody.dispose();
    }
  };

  // 8. Global collision observable — counts all collision events via Babylon pattern
  let collisionStartedCount = 0;
  let collisionContinuedCount = 0;
  plugin.onCollisionObservable.add((event: IPhysicsCollisionEvent) => {
    if (event.type === PhysicsEventType.COLLISION_STARTED) collisionStartedCount++;
    else if (event.type === PhysicsEventType.COLLISION_CONTINUED) collisionContinuedCount++;
  });

  // 9. Shape Cast button — exercises networked-query-ops.shapeCastAsync
  const queryButton = document.getElementById('queryButton') as HTMLButtonElement;
  let lastQueryResult = 'none';

  queryButton.addEventListener('click', async () => {
    queryButton.disabled = true;
    try {
      const shape: ShapeDescriptor = { type: 'sphere', params: { radius: 0.5 } };
      const result = await plugin.shapeCastAsync(
        shape,
        { x: 0, y: 15, z: 0 },
        { x: 0, y: -5, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
      if (result.hit && result.hitBodyId) {
        lastQueryResult = `hit ${result.hitBodyId} f=${result.fraction?.toFixed(3)}`;
        // Highlight hit body magenta for 500ms
        if (result.hitBody) {
          const hitMesh = result.hitBody.transformNode as Mesh;
          const mat = hitMesh?.material as StandardMaterial | null;
          if (mat) {
            const orig = mat.diffuseColor.clone();
            mat.diffuseColor = new Color3(1, 0, 1);
            setTimeout(() => { try { mat.diffuseColor = orig; } catch { /* disposed */ } }, 500);
          }
        }
      } else {
        lastQueryResult = 'no hit';
      }
    } catch (e) {
      lastQueryResult = `error: ${e}`;
    } finally {
      queryButton.disabled = false;
    }
  });

  // 10. Spin All button — exercises networked-query-ops.applyTorque
  const spinButton = document.getElementById('spinButton') as HTMLButtonElement;

  spinButton.addEventListener('click', () => {
    const torque = new Vector3(0, 10, 0);
    for (const [body, id] of plugin.bodyToId) {
      if (PROTECTED_NAMES.has(id)) continue;
      plugin.applyTorque(body, torque);
    }
  });

  // State update tracking for debug overlay
  let lastTick = 0;
  let lastDeltaCount = 0;
  plugin.onStateUpdate((state) => {
    lastTick = state.tick;
    lastDeltaCount = state.bodies.length;
  });

  // Render loop — just scene.render() + debug overlay
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
      `Collisions: ${collisionStartedCount} started, ${collisionContinuedCount} continued\n` +
      `Query: ${lastQueryResult}\n` +
      `Client: ${plugin.getClientId() ?? '?'}`;
  });

  window.addEventListener('resize', () => engine.resize());

  // Toggle Babylon.js Inspector with 'i' key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'i' || e.key === 'I') {
      if (scene.debugLayer.isVisible()) {
        scene.debugLayer.hide();
      } else {
        scene.debugLayer.show({ embedMode: true });
      }
    }
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

main();
