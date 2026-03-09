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
import { Engine, Scene, Vector3, MeshBuilder, PhysicsAggregate, PhysicsShapeType, PhysicsEventType, BallAndSocketConstraint } from '@babylonjs/core';
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

// 5. Apply forces/impulses — use standard Babylon.js PhysicsBody API
box.physicsBody.applyImpulse(new Vector3(0, 10, 0), box.position);

// 6. Add constraints — standard Babylon.js constraint API
const anchor = MeshBuilder.CreateBox('anchor', { size: 1 }, scene);
anchor.position.set(0, 8, 0);
const anchorAgg = new PhysicsAggregate(anchor, PhysicsShapeType.BOX, { mass: 0 }, scene);

const constraint = new BallAndSocketConstraint(
  new Vector3(0, 0, 0),   // pivot on anchor (center)
  new Vector3(0, 3, 0),   // pivot on box (3 units above its center)
  new Vector3(0, 1, 0),
  new Vector3(0, 1, 0),
  scene,
);
anchorAgg.body.addConstraint(box.physicsBody, constraint);

// 7. Collision handling — use standard Babylon.js observables
//    Per-body observable (fires only for this body's collisions):
box.physicsBody.setCollisionCallbackEnabled(true);
box.physicsBody.getCollisionObservable().add((event) => {
  if (event.type === PhysicsEventType.COLLISION_STARTED) {
    console.log('Hit!', event.collidedAgainst, event.point, event.impulse);
  }
});

//    Global observable (fires for all collisions in the scene):
plugin.onCollisionObservable.add((event) => {
  console.log(`${event.type}: ${event.collider} <-> ${event.collidedAgainst}`);
});

// 8. Listen for state updates and simulation resets
plugin.onStateUpdate((state) => {
  console.log(`Tick ${state.tick}, ${state.bodies.length} bodies updated`);
});

plugin.onSimulationReset(() => {
  // Re-create local bodies (ground, etc.)
});

// 9. Render loop
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

## Body Ownership

By default, bodies created by a client persist in the room even after that client disconnects. To have a body automatically removed when its creator disconnects, set `owned: true` in the mesh's metadata before creating the physics aggregate:

```ts
// Owned body — auto-removed when this client disconnects
const bullet = MeshBuilder.CreateSphere('bullet', { diameter: 0.2 }, scene);
bullet.metadata = { owned: true };
new PhysicsAggregate(bullet, PhysicsShapeType.SPHERE, { mass: 1 }, scene);

// Unowned body (default) — persists until explicitly removed
const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
```

If you're using the lower-level `PhysicsSyncClient` directly:

```ts
syncClient.addBody(descriptor, { owned: true });   // owned
syncClient.addBody(descriptor);                     // unowned (default)
```

The server validates ownership requests — a client can only own bodies as itself (the server stamps the real client ID regardless of what the client sends).

## Supported Shape Types

- `PhysicsShapeType.BOX`
- `PhysicsShapeType.SPHERE`
- `PhysicsShapeType.CAPSULE`
- `PhysicsShapeType.MESH`

## Physics Interactions

Use standard Babylon.js `PhysicsBody` methods — the plugin intercepts them and forwards to the server automatically:

```ts
// Apply impulse
body.physicsBody.applyImpulse(new Vector3(0, 10, 0), point);

// Apply force
body.physicsBody.applyForce(new Vector3(0, 50, 0), point);

// Set velocity
body.physicsBody.setLinearVelocity(new Vector3(5, 0, 0));
body.physicsBody.setAngularVelocity(new Vector3(0, 1, 0));

// Constraints
anchorBody.addConstraint(childBody, constraint);
```

## Collision Events

Collision events flow from the server through standard Babylon.js observables. Both local (`RapierPlugin`) and networked (`NetworkedRapierPlugin`) modes are supported.

### Per-Body Observables (recommended)

```ts
import { PhysicsEventType } from '@babylonjs/core';

// Enable collision callbacks on the body
body.physicsBody.setCollisionCallbackEnabled(true);

// COLLISION_STARTED fires once when contact begins
// COLLISION_CONTINUED fires each step while bodies remain in contact
body.physicsBody.getCollisionObservable().add((event) => {
  if (event.type === PhysicsEventType.COLLISION_STARTED) {
    console.log('Contact!', event.point, event.normal, event.impulse);
  }
});

// Optionally listen for collision ended
body.physicsBody.setCollisionEndedCallbackEnabled(true);
body.physicsBody.getCollisionEndedObservable().add((event) => {
  console.log('Separated from', event.collidedAgainst);
});
```

### Global Observables

```ts
// All collisions in the scene
plugin.onCollisionObservable.add((event) => { /* ... */ });
plugin.onCollisionEndedObservable.add((event) => { /* ... */ });
plugin.onTriggerCollisionObservable.add((event) => { /* ... */ });
```

### Event Types

| Type | Description |
|------|-------------|
| `COLLISION_STARTED` | Contact begins (includes point, normal, impulse) |
| `COLLISION_CONTINUED` | Bodies remain in contact (updated contact data each step) |
| `COLLISION_FINISHED` | Contact ends |
| `TRIGGER_ENTERED` | Body enters a sensor/trigger volume |
| `TRIGGER_EXITED` | Body exits a sensor/trigger volume |

For advanced use, `plugin.sendInput()` is also available:

| Action | Description |
|--------|-------------|
| `applyForce` | Apply continuous force to a body |
| `applyImpulse` | Apply instantaneous impulse (optionally at a point) |
| `applyAngularImpulse` | Apply angular impulse (torque) |
| `setVelocity` | Set a body's linear velocity |
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

### Demo Code On Github
  https://github.com/mikemainguy/rapierphysicsplugin/tree/main/packages/demo