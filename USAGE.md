# Usage Guide

This plugin is a drop-in replacement for the Babylon.js HavokPlugin. It implements the same `IPhysicsEnginePluginV2` interface, so standard Babylon.js physics code works without changes. This guide covers how to use each feature and calls out important differences from Havok.

## Table of Contents

- [Getting Started](#getting-started)
- [Bodies](#bodies)
- [Shapes](#shapes)
- [Constraints (Joints)](#constraints-joints)
- [Motors](#motors)
- [Axis Friction](#axis-friction)
- [Collision Events](#collision-events)
- [Queries](#queries)
- [Networking](#networking)
- [Differences from Havok](#differences-from-havok)
- [Known Gaps and Limitations](#known-gaps-and-limitations)

---

## Getting Started

### Standalone (Local Physics)

```ts
import { Engine, Scene, Vector3 } from '@babylonjs/core';
import { RapierPlugin } from '@rapierphysicsplugin/client';
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';

const backend = detectSIMDSupport() ? ComputeBackend.WASM_SIMD : ComputeBackend.WASM_COMPAT;
const RAPIER = await loadRapier({ backend });

const plugin = new RapierPlugin(RAPIER, new Vector3(0, -9.81, 0));
scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
```

### Networked (Server-Authoritative)

```ts
import { NetworkedRapierPlugin } from '@rapierphysicsplugin/client';
import { loadRapier, detectSIMDSupport, ComputeBackend } from '@rapierphysicsplugin/shared';

const RAPIER = await loadRapier({ backend });
const { plugin, snapshot } = await NetworkedRapierPlugin.createAsync(
  RAPIER,
  new Vector3(0, -9.81, 0),
  { serverUrl: 'ws://localhost:8080', roomId: 'my-room' },
  scene,
);
```

In networked mode, the server runs the authoritative simulation. Clients send inputs (forces, impulses) and receive interpolated state. All the same Babylon.js APIs work — the plugin transparently forwards operations to the server.

---

## Bodies

Create bodies with standard Babylon.js `PhysicsAggregate`:

```ts
import { MeshBuilder, PhysicsAggregate, PhysicsShapeType } from '@babylonjs/core';

const box = MeshBuilder.CreateBox('box', { size: 1 }, scene);
box.position.set(0, 5, 0);
const agg = new PhysicsAggregate(box, PhysicsShapeType.BOX, {
  mass: 1,        // 0 = static (immovable)
  friction: 0.5,
  restitution: 0.3,
}, scene);
```

### Motion Types

| Type | Babylon Enum | Behavior |
|------|-------------|----------|
| Dynamic | `PhysicsMotionType.DYNAMIC` | Full physics simulation |
| Static | `PhysicsMotionType.STATIC` | Immovable (mass = 0) |
| Kinematic | `PhysicsMotionType.ANIMATED` | Position set directly, not affected by forces |

### Forces and Impulses

```ts
const body = agg.body;

// Impulse at a point (instantaneous)
body.applyImpulse(new Vector3(0, 10, 0), mesh.position);

// Force at a point (continuous, apply each frame)
body.applyForce(new Vector3(0, 50, 0), mesh.position);

// Torque (rotational force)
plugin.applyTorque(body, new Vector3(0, 10, 0));

// Angular impulse
body.applyAngularImpulse(new Vector3(0, 5, 0));

// Direct velocity
body.setLinearVelocity(new Vector3(5, 0, 0));
body.setAngularVelocity(new Vector3(0, 3, 0));
```

### Body Properties

```ts
// Damping (air resistance)
plugin.setLinearDamping(body, 0.1);
plugin.setAngularDamping(body, 0.1);

// Gravity factor (0 = no gravity, 2 = double gravity)
plugin.setGravityFactor(body, 0.5);

// Mass properties
plugin.setMassProperties(body, {
  mass: 5,
  centerOfMass: new Vector3(0, 0, 0),
  inertia: new Vector3(1, 1, 1),
  inertiaOrientation: new Quaternion(0, 0, 0, 1),
});
```

### Body Ownership (Networked Only)

Bodies persist in the room after a client disconnects by default. To auto-remove a body when its creator disconnects:

```ts
mesh.metadata = { owned: true };
new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 1 }, scene);
```

### CCD (Continuous Collision Detection)

CCD is automatically enabled on all dynamic bodies. This prevents fast-moving objects from tunneling through thin surfaces. This is not configurable per-body.

---

## Shapes

All 8 Babylon.js shape types are supported:

| Shape | Type Enum | Notes |
|-------|-----------|-------|
| Box | `PhysicsShapeType.BOX` | Pass `extents` as full size (Babylon convention) |
| Sphere | `PhysicsShapeType.SPHERE` | |
| Capsule | `PhysicsShapeType.CAPSULE` | Defined by `pointA`, `pointB`, `radius` |
| Cylinder | `PhysicsShapeType.CYLINDER` | Defined by `pointA`, `pointB`, `radius` |
| Mesh | `PhysicsShapeType.MESH` | Trimesh — use for static geometry only |
| Convex Hull | `PhysicsShapeType.CONVEX_HULL` | Built from mesh vertices |
| Heightfield | `PhysicsShapeType.HEIGHTFIELD` | Terrain, supports `GroundMesh` auto-extraction |
| Container | `PhysicsShapeType.CONTAINER` | Compound shape with child shapes |

### Heightfield from GroundMesh

```ts
const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20, subdivisions: 32 }, scene);
new PhysicsAggregate(ground, PhysicsShapeType.HEIGHTFIELD, {
  mass: 0,
  friction: 0.8,
  groundMesh: ground,
} as any, scene);
```

### Shape Materials and Filtering

```ts
// Friction and restitution
plugin.setMaterial(shape, { friction: 0.5, restitution: 0.3 });

// Collision filtering (bitmask-based)
plugin.setShapeFilterMembershipMask(shape, 0x0001);  // What group this shape belongs to
plugin.setShapeFilterCollideMask(shape, 0x0002);      // What groups this shape collides with
```

### Triggers (Sensor Shapes)

```ts
plugin.setTrigger(shape, true);
// Trigger shapes detect overlap but don't produce contact forces
```

---

## Constraints (Joints)

### Supported Constraint Types

| Type | Class | Description |
|------|-------|-------------|
| Ball and Socket | `BallAndSocketConstraint` | 3-DOF spherical joint, free rotation |
| Hinge | `HingeConstraint` | 1 rotational DOF (door hinge, wheel axle) |
| Slider | `SliderConstraint` | 1 translational DOF |
| Prismatic | `PrismaticConstraint` | 1 translational DOF, rotations locked |
| Distance | `DistanceConstraint` | Maintains distance (rope-like) |
| Lock | `LockConstraint` | Rigid weld, no relative motion |
| 6-DOF | `Physics6DoFConstraint` | Generic, configure each axis independently |
| Spring | via 6-DOF with stiffness | Spring behavior via stiffness/damping |

### Creating a Constraint

```ts
import { HingeConstraint, PhysicsConstraintAxis, PhysicsConstraintMotorType } from '@babylonjs/core';

const hinge = new HingeConstraint(
  new Vector3(0, 1, 0),    // pivot on body A
  new Vector3(-1, 0, 0),   // pivot on body B
  new Vector3(0, 1, 0),    // hinge axis on A
  new Vector3(0, 1, 0),    // hinge axis on B
  scene,
);
bodyA.addConstraint(bodyB, hinge);
```

### Axis Limits

```ts
// Limit rotation range (radians)
plugin.setAxisMinLimit(hinge, PhysicsConstraintAxis.ANGULAR_X, -Math.PI / 4);
plugin.setAxisMaxLimit(hinge, PhysicsConstraintAxis.ANGULAR_X, Math.PI / 4);
```

### Enable/Disable

```ts
plugin.setEnabled(constraint, false);  // Temporarily disable
plugin.setEnabled(constraint, true);   // Re-enable

// Allow/prevent collisions between constrained bodies
plugin.setCollisionsEnabled(constraint, false);
```

---

## Motors

Motors drive a constraint axis toward a target velocity or position. They work on **hinge** (angular) and **slider/prismatic** (linear) constraints.

### Motor Types

| Type | Enum | Behavior |
|------|------|----------|
| None | `PhysicsConstraintMotorType.NONE` | No active drive (passive only) |
| Velocity | `PhysicsConstraintMotorType.VELOCITY` | Drives toward target angular/linear velocity |
| Position | `PhysicsConstraintMotorType.POSITION` | Drives toward target angle/position |

### Velocity Motor

Spins/slides the joint at a constant speed:

```ts
plugin.setAxisMotorType(hinge, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.VELOCITY);
plugin.setAxisMotorTarget(hinge, PhysicsConstraintAxis.ANGULAR_X, 3);     // 3 rad/s
plugin.setAxisMotorMaxForce(hinge, PhysicsConstraintAxis.ANGULAR_X, 500); // force limit
```

### Position Motor

Drives the joint to a specific angle or offset:

```ts
plugin.setAxisMotorType(hinge, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.POSITION);
plugin.setAxisMotorTarget(hinge, PhysicsConstraintAxis.ANGULAR_X, Math.PI / 2); // target angle
plugin.setAxisMotorMaxForce(hinge, PhysicsConstraintAxis.ANGULAR_X, 500);
```

### Stopping a Motor

Setting the motor type to `NONE` fully disengages the motor. If friction is configured (see below), the joint decelerates. If not, it coasts freely.

```ts
plugin.setAxisMotorType(hinge, PhysicsConstraintAxis.ANGULAR_X, PhysicsConstraintMotorType.NONE);
```

### Motor Parameters

Position motors use hardcoded stiffness (1000) and damping (100). Velocity motors use damping (100) as the velocity-tracking force factor. These values work well for most scenarios but are not currently user-configurable per-joint at the local plugin level. Over the network, `stiffness` and `damping` fields are available in axis updates for fine-tuning.

### Difference from Havok

Havok's motor system maps directly to its internal constraint solver. Rapier implements motors through its `configureMotorVelocity()` and `configureMotorPosition()` APIs. The behavior is functionally equivalent but tuning parameters may need adjustment since the underlying solvers differ. In particular:

- Havok's `motorMaxForce` directly limits the solver impulse. Rapier's max force similarly caps the motor force, but the response characteristics differ at high stiffness values.
- Position motor stiffness/damping are hardcoded in the local plugin. If you need custom values, use the networked plugin where `stiffness` and `damping` are sent as part of constraint updates.

---

## Axis Friction

Axis friction creates passive resistance on a joint axis. When a motor is turned off, friction decelerates the joint to a stop instead of letting it coast freely.

### How It Works

Rapier has no native joint friction API. The plugin simulates friction by configuring a velocity motor that targets zero velocity, using the friction value as the damping coefficient. This produces a force proportional to (and opposing) the joint's velocity — exactly how friction behaves.

When a motor is active (velocity or position), the motor's own damping handles resistance. Friction only takes effect when the motor type is `NONE`.

### Usage

```ts
// Set friction on a hinge's rotational axis
plugin.setAxisFriction(hinge, PhysicsConstraintAxis.ANGULAR_X, 20);

// Set friction on a slider's linear axis
plugin.setAxisFriction(slider, PhysicsConstraintAxis.LINEAR_X, 30);
```

### Friction Reference Values

| Value | Effect |
|-------|--------|
| 0 | Frictionless — joint coasts indefinitely (default) |
| 1 - 5 | Very light friction, slow deceleration |
| 10 - 30 | Moderate friction, visibly decelerates over a few seconds |
| 50 - 100 | Heavy friction, stops quickly |
| 500+ | Near-instant stop |

### Typical Pattern: Motor with Friction

```ts
// Set up motor and friction together
plugin.setAxisMotorType(hinge, axis, PhysicsConstraintMotorType.VELOCITY);
plugin.setAxisMotorTarget(hinge, axis, 3);       // spin at 3 rad/s
plugin.setAxisMotorMaxForce(hinge, axis, 500);
plugin.setAxisFriction(hinge, axis, 20);         // friction for when motor is off

// Later, turn off motor — friction takes over
plugin.setAxisMotorType(hinge, axis, PhysicsConstraintMotorType.NONE);
// Joint decelerates to a stop due to friction
```

### Difference from Havok

Havok applies joint friction directly through its constraint solver. This plugin uses a velocity motor to simulate friction, which is functionally similar but may produce slightly different deceleration curves. The friction value maps to Rapier's motor damping coefficient rather than a Coulomb friction model.

---

## Collision Events

### Per-Body Callbacks

```ts
import { PhysicsEventType } from '@babylonjs/core';

body.setCollisionCallbackEnabled(true);
body.getCollisionObservable().add((event) => {
  if (event.type === PhysicsEventType.COLLISION_STARTED) {
    console.log('Contact!', event.point, event.normal, event.impulse);
  }
});

// Collision ended
body.setCollisionEndedCallbackEnabled(true);
body.getCollisionEndedObservable().add((event) => {
  console.log('Separated from', event.collidedAgainst);
});
```

### Global Observables

```ts
plugin.onCollisionObservable.add((event) => { /* all collisions */ });
plugin.onCollisionEndedObservable.add((event) => { /* all separations */ });
plugin.onTriggerCollisionObservable.add((event) => { /* trigger overlaps */ });
```

### Event Types

| Type | When |
|------|------|
| `COLLISION_STARTED` | First frame of contact (includes point, normal, impulse) |
| `COLLISION_CONTINUED` | Each frame while bodies remain in contact |
| `COLLISION_FINISHED` | Contact ends |
| `TRIGGER_ENTERED` | Body enters a sensor/trigger volume |
| `TRIGGER_EXITED` | Body exits a sensor/trigger volume |

### Difference from Havok

- `COLLISION_CONTINUED` is synthesized by tracking active pairs between Rapier events, since Rapier only reports start/stop. The behavior matches Havok's from the application's perspective.
- In networked mode, collision events come from the server. The server detects collisions and broadcasts them; the client maps body IDs to local `PhysicsBody` objects and fires the standard Babylon.js observables.

---

## Queries

### Raycast

```ts
import { PhysicsRaycastResult, Vector3 } from '@babylonjs/core';

const result = new PhysicsRaycastResult();
plugin.raycast(
  new Vector3(0, 10, 0),  // from
  new Vector3(0, -10, 0), // to
  result,
  { shouldHitTriggers: false },
);

if (result.hasHit) {
  console.log(result.hitPointWorld, result.hitNormalWorld, result.hitDistance);
}
```

### Shape Cast (Sweep)

Sweeps a shape along a path and returns the first hit:

```ts
import { ShapeCastResult } from '@babylonjs/core/Physics/shapeCastResult';

const inputResult = new ShapeCastResult();
const hitResult = new ShapeCastResult();

plugin.shapeCast(
  {
    shape: myShape,              // PhysicsShape (box, sphere, capsule, cylinder, convex hull)
    startPosition: new Vector3(0, 10, 0),
    endPosition: new Vector3(0, -10, 0),
    rotation: Quaternion.Identity(),
    shouldHitTriggers: false,
  },
  inputResult,
  hitResult,
);

if (hitResult.hasHit) {
  console.log(hitResult.hitFraction, hitResult.hitPoint, hitResult.hitNormal);
}
```

### Shape Proximity

Finds the closest surface point to a shape within a max distance:

```ts
import { ProximityCastResult } from '@babylonjs/core/Physics/proximityCastResult';

const inputResult = new ProximityCastResult();
const hitResult = new ProximityCastResult();

plugin.shapeProximity(
  { shape: myShape, position: pos, rotation: rot, maxDistance: 5.0 },
  inputResult,
  hitResult,
);
```

### Point Proximity

Finds the closest surface point to a world-space point:

```ts
const result = new ProximityCastResult();
plugin.pointProximity(
  { position: new Vector3(0, 5, 0), maxDistance: 10.0 },
  result,
);
```

### Networked Queries (Async)

In networked mode, queries run on the server and return asynchronously:

```ts
const result = await plugin.shapeCastAsync(
  { type: 'sphere', params: { radius: 0.5 } },
  { x: 0, y: 15, z: 0 },    // start
  { x: 0, y: -5, z: 0 },    // end
  { x: 0, y: 0, z: 0, w: 1 }, // rotation
);

if (result.hit) {
  console.log(result.hitBodyId, result.fraction, result.hitBody);
}
```

### Query Shape Limitations

Trimesh (`MESH`) and heightfield (`HEIGHTFIELD`) shapes cannot be used as query shapes for shape cast or proximity queries. This is a Rapier engine limitation. Use box, sphere, capsule, cylinder, or convex hull shapes for queries.

---

## Networking

### Architecture

```
Server (60 Hz physics, 20 Hz state broadcast)
  └─ WebSocket ──► Client
                     ├─ ClockSyncClient (RTT + offset estimation)
                     ├─ StateReconciler (feeds snapshots to interpolator)
                     ├─ Interpolator (Hermite spline + SLERP, configurable render delay)
                     └─ Render loop (60 Hz) queries interpolator ──► BabylonJS meshes
```

The server is fully authoritative. Clients send inputs (forces, impulses, velocity changes) and receive interpolated state. There is no client-side prediction.

### State Updates

```ts
plugin.onStateUpdate((state) => {
  console.log(`Tick: ${state.tick}, Bodies updated: ${state.bodies.length}`);
});
```

### Simulation Reset

```ts
plugin.onSimulationReset(() => {
  // Re-create local bodies (ground, constraints, etc.)
});
```

### Debug Stats

```ts
const reconciler = plugin.getReconciler();
const interpolator = reconciler.getInterpolator();
const clockSync = plugin.getClockSync();

const stats = interpolator.getStats();  // interpolated/extrapolated/stale counts
const rtt = clockSync.getRTT();         // round-trip time in ms
const offset = clockSync.getClockOffset();
```

### Bandwidth

State updates use delta compression — only bodies whose state changed since the last broadcast are sent. Binary serialization via msgpackr with custom typed array extensions keeps wire size small.

```ts
console.log(plugin.bytesSent, plugin.bytesReceived);
```

---

## Differences from Havok

### Behavioral Differences

| Feature | Havok | Rapier Plugin |
|---------|-------|---------------|
| Physics engine | Havok (proprietary) | Rapier (open source, WASM) |
| Solver | Iterative impulse solver | Superspiel/PGS solver |
| CCD | Configurable per-body | Always enabled on dynamic bodies |
| Joint friction | Native solver parameter | Simulated via velocity motor damping |
| Motor stiffness/damping | Configurable per-motor | Hardcoded (stiffness=1000, damping=100) locally; configurable over network |
| Sleep/island management | Configurable | Managed by Rapier, not exposed |
| `COLLISION_CONTINUED` | Native event | Synthesized from active pair tracking |
| Heightfield storage | Row-major | Column-major (Rapier convention) |
| Instance physics | Supported | Not supported (no-op) |

### API Compatibility

The plugin implements the full `IPhysicsEnginePluginV2` interface. You can swap `HavokPlugin` for `RapierPlugin` (or `NetworkedRapierPlugin`) and existing Babylon.js physics code will work. The only methods that differ are:

- `initBodyInstances()` / `updateBodyInstances()` — no-ops (Rapier doesn't support instanced physics bodies)

### Tuning Differences

Physics behavior may differ between Havok and Rapier because the underlying solvers work differently. Common areas where tuning may be needed:

- **Restitution (bounciness)** — Rapier tends to be slightly more bouncy at the same restitution values
- **Motor response** — position motors may overshoot or oscillate differently due to hardcoded stiffness/damping
- **Stacking stability** — Rapier handles deep stacks well but may behave differently from Havok with many small overlapping bodies
- **Joint compliance** — joints under heavy load may flex differently

---

## Known Gaps and Limitations

### Not Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Instanced physics bodies | Not supported | `initBodyInstances()` / `updateBodyInstances()` are no-ops. Rapier has no concept of instanced rigid bodies. |
| Soft bodies / cloth | Not supported | Rapier is a rigid body engine |
| Fluid / particle physics | Not supported | Outside Rapier's scope |
| Character controllers | Not built-in | Rapier has a character controller module but it's not exposed through this plugin |
| Vehicle physics | Not built-in | Can be composed from constraints and motors |

### Partially Implemented

| Feature | Limitation |
|---------|-----------|
| Query shapes | Trimesh and heightfield cannot be used as query shapes (Rapier limitation) |
| Motor stiffness/damping | Hardcoded at stiffness=1000, damping=100 in the local plugin. Configurable over the network via `stiffness`/`damping` fields in axis updates. |
| Per-body CCD | CCD is always enabled on dynamic bodies and cannot be disabled or configured per-body |
| Axis limits on 6-DOF | Axis limits are applied during constraint creation for 6-DOF joints but per-axis runtime limit changes are only supported on hinge and slider/prismatic types |
| Container collider | Container (compound) shapes use a minimal placeholder collider internally. Children are added as separate colliders with local transforms. |

### Networking Limitations

| Limitation | Details |
|------------|---------|
| No client-side prediction | Clients display interpolated server state with a render delay (default ~150ms). Input feels slightly delayed. |
| Body count scaling | All body states are broadcast to all clients. Very large scenes (1000+ bodies) may saturate bandwidth. |
| Constraint sync | Constraints are synced by descriptor. Runtime axis limit changes are sent as updates, but initial constraint setup must happen before the double-microtask flush. |
| Asset sync | Geometry, materials, and textures are synced via content-hash deduplication. Very large meshes may cause initial join latency. |

### Platform Notes

- **WASM SIMD** — use `ComputeBackend.WASM_SIMD` for best performance on supporting browsers/runtimes. Falls back to `WASM_COMPAT` automatically.
- **Server-side** — the server uses the same Rapier WASM. For production, use the SIMD backend (`PHYSICS_BACKEND=wasm-simd`).
- **Memory** — Rapier WASM objects must be freed when disposed. The plugin handles this automatically through `dispose()` calls, but leaks can occur if bodies/constraints are abandoned without disposal.
