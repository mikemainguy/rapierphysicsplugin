# Release Notes — v1.0.16

## Character Controller

**What it does:** New `RapierCharacterController` class provides first-person/third-person character movement with WASD input, jumping, ground detection, slope handling, autostep over small obstacles, snap-to-ground, and the ability to push dynamic bodies. The controller works with both local `RapierPlugin` and networked `NetworkedRapierPlugin`.

**How it works:** The controller creates a kinematic Rapier rigid body with a capsule collider and uses Rapier's built-in `KinematicCharacterController` for collision resolution. Each frame, the caller sets velocity from input, then calls `checkSupport()` to detect ground contact and `integrate()` to apply gravity, resolve collisions, and update position.

**Usage:**

```ts
import { RapierCharacterController, CharacterSupportedState } from '@rapierphysicsplugin/client';

// Create controller — visual mesh is separate (no PhysicsAggregate)
const controller = new RapierCharacterController(
  new Vector3(0, 3, 0),
  { capsuleHeight: 1, capsuleRadius: 0.3 },
  plugin,
);
controller.enableAutostep(0.4, 0.2, true);
controller.enableSnapToGround(0.3);
controller.characterStrength = true;  // push dynamic bodies
controller.characterMass = 70;

// Per-frame update
const supportInfo = controller.checkSupport(dt, gravity);
const vel = controller.getVelocity();
if (keysDown.has('Space') && supportInfo.supportedState === CharacterSupportedState.SUPPORTED) {
  vel.y = 5; // jump
}
vel.x = desiredVelocity.x;
vel.z = desiredVelocity.z;
controller.setVelocity(vel);
controller.integrate(dt, supportInfo, gravity);

// Sync mesh
mesh.position.copyFrom(controller.getPosition());
```

**Exported types:**
- `RapierCharacterController` — main class
- `CharacterSupportedState` — enum: `UNSUPPORTED`, `SLIDING`, `SUPPORTED`
- `CharacterSurfaceInfo` — ground detection result (type)
- `CharacterShapeOptions` — constructor options (type)
- `ICharacterControllerCollisionEvent` — collision observable event (type)

## Query Pipeline Fix for Networked Plugin

**What it does:** Fixes character controller (and any Rapier spatial query) falling through colliders when used with `NetworkedRapierPlugin`. The networked plugin delegates physics stepping to the server and never calls `world.step()` locally, which left Rapier's internal query pipeline uninitialized — causing `computeColliderMovement` to miss all colliders.

**How it works:** The character controller now calls `world.step()` with a zero timestep before each collision query. This rebuilds the query pipeline without advancing physics or moving any bodies. The original timestep is saved and restored.

## Spring Constraint Demo

**What it does:** Adds a spring constraint demo to the demo scene — a static cyan anchor sphere connected to a dynamic yellow sphere via a `SpringConstraint`. The dynamic sphere bounces elastically around the anchor, demonstrating spring stiffness and damping parameters.

## Demo Cone Fix

**What it does:** Fixes cone spawning in the demo by switching from thin instances to Babylon `createInstance()`. Thin instances lack individual `physicsBody` references, which broke per-body impulse and removal. Each cone instance now has its own physics aggregate and collision flash.

## Character Controller Demo

**What it does:** Adds a "Character: OFF/ON" toggle button (teal) to the demo UI panel. When enabled, spawns a light-blue capsule controlled by WASD + Space with camera-relative movement and automatic camera follow.

**Controls:**
- **WASD** — move relative to camera orientation
- **Space** — jump (only when grounded)
- **Mouse** — orbit camera around character

## Unit Conversion Helpers

**What it does:** New helper functions in `@rapierphysicsplugin/shared` for converting between common velocity units and Rapier's internal SI units.

### Physics Units in Rapier

Rapier uses SI units throughout. When 1 world unit = 1 meter:

| Quantity | Internal unit | Symbol |
|----------|--------------|--------|
| Distance | meters | m |
| Time | seconds | s |
| Mass | kilograms | kg |
| Linear velocity | meters per second | m/s |
| Angular velocity | radians per second | rad/s |
| Force | Newtons | N (kg·m/s²) |
| Impulse | Newton-seconds | N·s (kg·m/s) |
| Torque | Newton-meters | N·m |
| Gravity | meters per second² | m/s² |
| Friction / Restitution | dimensionless | 0–1 |
| Spring stiffness | Newtons per meter | N/m |
| Spring damping | Newton-seconds per meter | N·s/m |

**Gravity** is set to `(0, -9.81, 0)` by default — standard Earth gravity in m/s².

### Common conversions

| From | To | Formula | Example |
|------|----|---------|---------|
| mph | m/s | × 0.44704 | 60 mph = 26.82 m/s |
| km/h | m/s | ÷ 3.6 | 100 km/h = 27.78 m/s |
| RPM | rad/s | × 2π/60 | 60 RPM = 6.28 rad/s |

### Conversion functions

```ts
import { mphToMs, kmhToMs, msToMph, msToKmh, rpmToRadS, radSToRpm } from '@rapierphysicsplugin/shared';

// Set a car's velocity to 60 mph
plugin.setLinearVelocity(body, new Vector3(mphToMs(60), 0, 0));

// Set a wheel spinning at 300 RPM
plugin.setAxisMotorTarget(constraint, axis, rpmToRadS(300));

// Read back velocity in familiar units
const vel = body.getLinearVelocity();
console.log(`Speed: ${msToMph(vel.length())} mph`);
console.log(`Speed: ${msToKmh(vel.length())} km/h`);
```

| Function | Direction |
|----------|-----------|
| `mphToMs(mph)` | miles/hour → m/s |
| `kmhToMs(kmh)` | km/hour → m/s |
| `msToMph(ms)` | m/s → miles/hour |
| `msToKmh(ms)` | m/s → km/hour |
| `rpmToRadS(rpm)` | RPM → rad/s |
| `radSToRpm(radS)` | rad/s → RPM |

### Force vs impulse: a practical note

Rapier's `addForce()` **accumulates** — forces are not cleared between physics steps. To apply a sustained constant force, use per-step impulses instead:

```ts
// Sustained 1 N force (correct)
const dt = engine.getDeltaTime() / 1000;
body.applyImpulse(new Vector3(1 * dt, 0, 0), body.position);

// Single-step addForce (force persists until resetForces!)
body.applyForce(new Vector3(1, 0, 0), body.position);
```

### Real-world reference values

| Scenario | Value | In Rapier |
|----------|-------|-----------|
| Walking speed | 5 km/h | `kmhToMs(5)` = 1.39 m/s |
| Jogging | 10 km/h | `kmhToMs(10)` = 2.78 m/s |
| Sprinting | 30 km/h | `kmhToMs(30)` = 8.33 m/s |
| Car in town | 30 mph | `mphToMs(30)` = 13.41 m/s |
| Highway speed | 65 mph | `mphToMs(65)` = 29.06 m/s |
| Free fall 1 s | 9.81 m/s | 9.81 (gravity) |
| Jump peak 1 m | | v₀ = √(2·g·h) = 4.43 m/s |
| Jump peak 2 m | | v₀ = √(2·g·h) = 6.26 m/s |
| Electric motor | 3000 RPM | `rpmToRadS(3000)` = 314.16 rad/s |
| Ceiling fan | 200 RPM | `rpmToRadS(200)` = 20.94 rad/s |

## Physics Simulation Validation Tests

Added 18 integration tests that run the real Rapier WASM engine and verify simulation results match physics equations (1 unit = 1 meter):

- **Linear velocity** — 1 m/s for 1 s = 1 m displacement; diagonal 3-4-5 triangle
- **Unit conversions** — 60 mph, 100 km/h, 60 RPM produce correct simulation results
- **Gravity** — free fall distances match ½gt² (4.9 m at 1 s, 19.6 m at 2 s)
- **Impulse** — F=ma verified: 1 N·s on 1 kg = 1 m/s; 5 N·s on 5 kg = 1 m/s
- **Force** — single-step F·dt/m; sustained force via impulse-per-step; gravity cancellation
- **Projectile motion** — horizontal launch and vertical launch to peak height

## Test Suite

Added 48 tests for the character controller, 6 tests for unit conversions, and 18 physics simulation validation tests. Total test count: 704 tests across 34 test files (all passing).

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| client | `src/index.ts` | Export `RapierCharacterController`, `CharacterSupportedState`, and related types |
| client | `src/rapier/character-controller.ts` | New character controller class with query pipeline fix |
| client | `src/rapier/__tests__/character-controller.test.ts` | 48 tests for character controller |
| shared | `src/units.ts` | Unit conversion helpers (mph, km/h, RPM ↔ m/s, rad/s) |
| shared | `src/index.ts` | Export unit conversion functions |
| shared | `src/__tests__/units.test.ts` | 6 tests for unit conversions |
| server | `src/__tests__/physics-units.test.ts` | 18 physics simulation validation tests |
| demo | `index.html` | Add `#charButton` with teal styling |
| demo | `src/main.ts` | Character controller integration, WASD input, camera follow, toggle button |
