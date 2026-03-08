# @rapierphysicsplugin/shared

Shared types, protocol definitions, and serialization utilities for the Rapier Physics Plugin. Used by both `@rapierphysicsplugin/client` and `@rapierphysicsplugin/server`.

## Installation

```bash
npm install @rapierphysicsplugin/shared
```

## What's included

### Types

Core data structures for physics simulation and networking:

- **`Vec3`, `Quat`** — vector and quaternion interfaces
- **`BodyState`** — runtime physics state (position, rotation, velocities)
- **`BodyDescriptor`** — static body definition (shape, motion type, mass, friction, restitution)
- **`ShapeType`** — `'box' | 'sphere' | 'capsule' | 'mesh'`
- **`MotionType`** — `'dynamic' | 'static' | 'kinematic'`
- **`InputAction`** — commands to apply forces, impulses, or set velocities on bodies
- **`CollisionEventData`** — collision event info (bodies, contact point, impulse)
- **`ConstraintDescriptor`** — joint definitions (hinge, ball-and-socket, slider, distance, lock, prismatic, 6-DOF, spring)

### Protocol

`MessageType` enum and typed message interfaces for client-server communication:

- `CLOCK_SYNC_REQUEST / CLOCK_SYNC_RESPONSE`
- `JOIN_ROOM / ROOM_STATE`
- `CLIENT_INPUT / COLLISION_EVENTS`
- `ADD_BODY / REMOVE_BODY / ADD_CONSTRAINT / REMOVE_CONSTRAINT`
- `START_SIMULATION`

### Serialization

Binary encoding/decoding with msgpackr and custom binary codecs:

```ts
import { encodeMessage, decodeMessage } from '@rapierphysicsplugin/shared';

const bytes = encodeMessage({ type: MessageType.CLIENT_INPUT, ... });
const msg = decodeMessage(bytes);
```

Includes specialized codecs for compact state updates (field masks, delta encoding), mesh geometry, materials, and content-hash deduplication.

### Rapier Loader

Dynamic WASM loader with automatic SIMD fallback: 

```ts
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';

const backend = detectSIMDSupport() ? ComputeBackend.WASM_SIMD : ComputeBackend.WASM_COMPAT;
const RAPIER = await loadRapier({ backend });
```

### Constraint Utilities

Convert `ConstraintDescriptor` objects to Rapier `JointData`:

```ts
import { createJointData } from '@rapierphysicsplugin/shared';

const jointData = createJointData(RAPIER, descriptor);
```

### Constants

- `SERVER_TICK_RATE` — 60 Hz physics simulation
- `BROADCAST_RATE` — 20 Hz state updates to clients
- `CLIENT_INPUT_RATE` — 60 Hz client input sends

## Dependencies

- `@dimforge/rapier3d-compat` — Rapier WASM physics engine
- `@dimforge/rapier3d-simd-compat` (optional) — SIMD-accelerated build
- `msgpackr` — binary serialization
