# @rapierphysicsplugin/client

A Babylon.js physics engine plugin powered by [Rapier](https://rapier.rs/) with built-in networked multiplayer support. Use standard Babylon.js `PhysicsAggregate` / `PhysicsBody` APIs and get server-authoritative physics synchronization automatically.

## Installation

```bash
npm install @rapierphysicsplugin/client @rapierphysicsplugin/shared
```

### Peer dependencies

- `@babylonjs/core` >= 6.0.0

## Quick Start

```ts
import { Engine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType } from '@babylonjs/core';
import { NetworkedRapierPlugin } from '@rapierphysicsplugin/client';
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';

// 1. Load Rapier WASM
const backend = detectSIMDSupport() ? ComputeBackend.WASM_SIMD : ComputeBackend.WASM_COMPAT;
const RAPIER = await loadRapier({ backend });

// 2. Create Babylon.js scene
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

// 3. Create plugin and connect to server
const gravity = new Vector3(0, -9.81, 0);
const { plugin } = await NetworkedRapierPlugin.createAsync(
  RAPIER, gravity,
  { serverUrl: 'ws://localhost:8080', roomId: 'my-room' },
  scene,
);

// 4. Create physics bodies — standard Babylon.js API
const box = MeshBuilder.CreateBox('box', { size: 1 }, scene);
box.position.set(0, 5, 0);
new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 1, friction: 0.5, restitution: 0.3 }, scene);

// The plugin automatically syncs bodies with the server.
// Remote clients' bodies appear in your scene automatically.

// 5. Send input (e.g., apply impulse on click)
plugin.sendInput([{
  type: 'applyImpulse',
  bodyId: box.metadata.bodyId,
  data: { impulse: { x: 0, y: 10, z: 0 } },
}]);

// 6. Listen for events
plugin.onStateUpdate((state) => {
  console.log(`Tick ${state.tick}, ${state.bodies.length} bodies updated`);
});

plugin.onCollisionEvents((events) => {
  events.forEach(e => console.log(`Collision: ${e.bodyId1} <-> ${e.bodyId2}`));
});

plugin.onSimulationReset(() => {
  // Re-create local bodies (ground, etc.)
});

// 7. Render loop
engine.runRenderLoop(() => scene.render());
```

### Advanced: Manual Setup

If you need to customize the scene between plugin creation and connection (e.g. adding bodies before connecting, or deferring the connection), use the constructor and `connect()` separately:

```ts
const plugin = new NetworkedRapierPlugin(RAPIER, gravity, {
  serverUrl: 'ws://localhost:8080',
  roomId: 'my-room',
});

scene.enablePhysics(gravity, plugin);

// ... do custom scene setup here ...

await plugin.connect(scene);
```

## Supported Shape Types

- `PhysicsShapeType.BOX`
- `PhysicsShapeType.SPHERE`
- `PhysicsShapeType.CAPSULE`
- `PhysicsShapeType.MESH`

## Input Actions

Send physics commands to the server via `plugin.sendInput()`:

| Action | Description |
|--------|-------------|
| `applyForce` | Apply continuous force to a body |
| `applyImpulse` | Apply instantaneous impulse (optionally at a point) |
| `setLinearVelocity` | Set a body's linear velocity |
| `setAngularVelocity` | Set a body's angular velocity |
| `setPosition` | Teleport a body to a position |

## Architecture

The plugin uses a **server-authoritative** model:

- **Local physics are skipped** — the server runs the simulation
- **State interpolation** — remote bodies are smoothly interpolated between server snapshots
- **Clock synchronization** — RTT-based time sync keeps client and server aligned
- **Delta compression** — only changed body states are sent over the wire

### Exported Classes

| Class | Purpose |
|-------|---------|
| `NetworkedRapierPlugin` | Main entry point — Babylon.js plugin with networking |
| `RapierPlugin` | Standalone Babylon.js Rapier plugin (no networking) |
| `PhysicsSyncClient` | Low-level WebSocket sync client |
| `ClockSyncClient` | Network time synchronization |
| `StateReconciler` | Manages local vs. remote body state |
| `Interpolator` | Smooth interpolation/extrapolation of remote bodies |
| `InputManager` | Input batching and history |

## Debug Info

Access runtime stats for debug overlays:

```ts
const reconciler = plugin.getReconciler();
const interpolator = reconciler.getInterpolator();
const clockSync = plugin.getClockSync();

const stats = interpolator.getStats();  // interpolated/extrapolated/stale counts
const rtt = clockSync.getRTT();         // round-trip time in ms
const offset = clockSync.getClockOffset();
```

## Dependencies

- `@babylonjs/core` (peer) — Babylon.js engine
- `@dimforge/rapier3d-compat` — Rapier WASM physics
- `@rapierphysicsplugin/shared` — types and serialization
