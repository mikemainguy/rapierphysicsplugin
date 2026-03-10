# @rapierphysicsplugin/server

Server-authoritative physics simulation server powered by [Rapier](https://rapier.rs/). Runs the physics world, accepts client connections over WebSocket, and broadcasts state updates to all connected clients.

## Installation

```bash
npm install @rapierphysicsplugin/server @rapierphysicsplugin/shared
```

## Quick Start

```ts
import { loadRapier, ComputeBackend } from '@rapierphysicsplugin/shared';
import { PhysicsServer } from '@rapierphysicsplugin/server';

// 1. Load Rapier WASM (SIMD for best performance)
const RAPIER = await loadRapier({ backend: ComputeBackend.WASM_SIMD });

// 2. Create and start the server
const server = new PhysicsServer(RAPIER);
await server.start(8080);

// 3. Create a room
const roomManager = server.getRoomManager();
roomManager.createRoom('my-room');

// 4. Graceful shutdown
process.on('SIGINT', () => {
  server.stop();
  process.exit(0);
});
```

Clients connect via WebSocket, join a room, and the server handles everything automatically — physics stepping, state broadcasting, input processing, and body synchronization.

## How It Works

1. **Client connects** via WebSocket and sends a `JOIN_ROOM` message
2. **Server sends** a full state snapshot and replays existing body/constraint descriptors
3. **Physics loop** runs at 60 Hz (`SERVER_TICK_RATE`)
4. **State broadcasts** are sent at 20 Hz (`BROADCAST_RATE`) with delta compression
5. **Client inputs** (forces, impulses, velocity changes) are applied to the physics world each tick
6. **Collision events** are batched and broadcast to all clients in the room

## Pre-loading Bodies

You can load an initial state into a room before clients connect:

```ts
const room = roomManager.createRoom('my-room');

room.loadInitialState([
  {
    id: 'ground',
    shape: 'box',
    halfExtents: { x: 10, y: 0.5, z: 10 },
    motionType: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    friction: 0.8,
    restitution: 0.3,
  },
]);
```

## Body Ownership

Bodies can optionally be **owned** by a client. When an owning client disconnects, all of their owned bodies are automatically removed from the room. Bodies without an owner persist until explicitly removed.

### Client-spawned bodies

When a client sends an `ADD_BODY` message with `ownerId` set (any truthy value), the server overwrites it with the real client ID. This prevents spoofing while giving clients a simple opt-in mechanism.

### Server-side ownership

You can assign ownership directly when creating bodies in server game code:

```ts
const room = roomManager.createRoom('my-room');

// Owned body — removed when client_42 disconnects
room.addBody({ ...descriptor, ownerId: 'client_42' });

// Unowned body — persists forever (default)
room.addBody(descriptor);
```

### Querying ownership

```ts
room.getBodyOwner('box_1');          // → 'client_42' | undefined
room.getClientBodies('client_42');   // → ReadonlySet<string>
```

## SIMD Backend

For best performance, use the SIMD backend. Set via environment variable:

```bash
PHYSICS_BACKEND=wasm-simd node server.js
```

Or pass it directly:

```ts
const RAPIER = await loadRapier({ backend: ComputeBackend.WASM_SIMD });
```

Falls back to `wasm-compat` automatically if SIMD is unavailable.

## Architecture

| Class | Purpose |
|-------|---------|
| `PhysicsServer` | WebSocket server, routes messages to rooms |
| `PhysicsWorld` | Rapier world wrapper — steps physics, applies inputs, generates snapshots |
| `Room` | Manages a physics world + connected clients, handles body sync and ownership |
| `RoomManager` | Creates and retrieves rooms |
| `SimulationLoop` | Runs the physics tick loop at 60 Hz |
| `StateManager` | Generates full snapshots and delta-compressed state updates |
| `InputBuffer` | Per-client input queue, executes inputs in tick order |
| `ClientConnection` | Per-client WebSocket wrapper |

## Dependencies

- `@dimforge/rapier3d-compat` — Rapier WASM physics engine
- `@dimforge/rapier3d-simd-compat` (optional) — SIMD-accelerated build
- `ws` — WebSocket server
- `@rapierphysicsplugin/shared` — types and serialization

## Release Notes

- [v1.0.10](../../RELEASE_NOTES_1_0_10.md) — Cylinder, convex hull, heightfield, and container shapes; msgpackr typed array serialization fix
