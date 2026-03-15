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

## Test Suite

Added 48 tests for the character controller covering construction, position/velocity, properties, autostep/snap-to-ground, `checkSupport`, `integrate`, `moveWithCollisions`, `calculateMovementToRef`, disposal, and collision observables. Total test count: 680 tests across 32 test files (all passing).

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| client | `src/index.ts` | Export `RapierCharacterController`, `CharacterSupportedState`, and related types |
| client | `src/rapier/character-controller.ts` | New character controller class with query pipeline fix |
| client | `src/rapier/__tests__/character-controller.test.ts` | 48 tests for character controller |
| demo | `index.html` | Add `#charButton` with teal styling |
| demo | `src/main.ts` | Character controller integration, WASD input, camera follow, toggle button |
