# Release Notes — v1.0.15

## Pre-step Transform Sync

**What it does:** Before each physics step, the plugin now syncs transform-node positions back to physics bodies — matching HavokPlugin's behavior. This is critical for kinematic bodies driven by Babylon.js animations, editor manipulation, or script-based movement. Without this, moving a kinematic body's transform node had no effect on its physics body.

**How it works:** In `executeStep()`, before calling `world.step()`, the plugin loops over all bodies. For each body that hasn't set `disablePreStep = true`, it reads the body's `getPrestepType()` to decide how to sync:

- **TELEPORT (1)** — directly sets the physics body position/rotation from the transform node (default)
- **ACTION (2)** — uses `setTargetTransform()` for velocity-based kinematic interpolation toward the target
- **DISABLED (0)** — no-op

**Usage:**

```ts
// Kinematic body driven by animation — works automatically now
const body = new PhysicsBody(mesh, PhysicsMotionType.ANIMATED, false, scene);
// Animate the mesh — the physics body follows automatically each step

// Opt out of pre-step sync for a specific body
(body as any).disablePreStep = true;

// Use ACTION mode for smooth kinematic interpolation instead of teleport
// (setPrestepType is a Babylon.js PhysicsBody method)
body.setPrestepType(PhysicsPrestepType.ACTION);
```

The sync reads `absolutePosition` / `absoluteRotationQuaternion` when available, falling back to `position` / `rotationQuaternion`. For instanced bodies, the primary transform node is synced; instance matrices are managed separately via `updateBodyInstances`.

## Multi-hit Raycast

**What it does:** The `raycast()` method now supports the full `IPhysicsEnginePluginV2` interface signature — accepting either a single `PhysicsRaycastResult` or an `Array<PhysicsRaycastResult>`. Previously, passing an array would silently fail.

**How it works:**

- **Single result** (or array with length 1) — uses `castRayAndGetNormal` as before (closest hit)
- **Array with length > 1** — uses Rapier's `intersectionsWithRay` callback API to collect multiple hits, filling the array up to its length then stopping

All results are `reset()` before the cast, matching HavokPlugin's behavior.

**Usage:**

```ts
// Single hit (unchanged)
const result = new PhysicsRaycastResult();
plugin.raycast(from, to, result);

// Multi-hit — pre-allocate array with desired max hits
const results = [
  new PhysicsRaycastResult(),
  new PhysicsRaycastResult(),
  new PhysicsRaycastResult(),
];
plugin.raycast(from, to, results);

// Check which results got hits
for (const r of results) {
  if (r.hasHit) {
    console.log('Hit at', r.hitPointWorld, 'normal', r.hitNormalWorld);
  }
}
```

## Activation Control

**What it does:** New `setActivationControl(body, controlMode)` method for controlling body sleep/wake behavior, matching HavokPlugin's non-interface utility. Three modes:

- **SIMULATION_CONTROLLED (0)** — engine manages sleep/wake (default). Calling this wakes the body and returns it to normal behavior.
- **ALWAYS_ACTIVE (1)** — wakes the body. Useful for bodies that must never be deactivated by the engine.
- **ALWAYS_INACTIVE (2)** — puts the body to sleep immediately.

**Usage:**

```ts
// Keep a body always awake (e.g. a sensor that must always detect)
plugin.setActivationControl(body, 1);

// Force a body to sleep
plugin.setActivationControl(body, 2);

// Return to engine-managed sleep/wake
plugin.setActivationControl(body, 0);
```

## Test Suite

Added 17 new tests covering pre-step transform sync (7 tests), multi-hit raycast (6 tests), and activation control (4 tests). Total test count: 632 tests across 31 test files (all passing).

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| client | `src/rapier/plugin.ts` | Pre-step loop in `executeStep()`, `setPhysicsBodyTransformation()`, `setActivationControl()`, `raycast()` signature updated to accept array |
| client | `src/rapier/body-ops.ts` | `setPhysicsBodyTransformation()` with TELEPORT/ACTION/DISABLED modes, `setActivationControl()` with sleep/wake |
| client | `src/rapier/query-ops.ts` | `raycast()` updated to handle `Array<PhysicsRaycastResult>` via `intersectionsWithRay`, `reset()` on all results |
| client | `src/rapier/__tests__/body-ops.test.ts` | 11 new tests for pre-step sync and activation control |
| client | `src/rapier/__tests__/query-ops.test.ts` | 6 new tests for multi-hit raycast, reset behavior, edge cases |
