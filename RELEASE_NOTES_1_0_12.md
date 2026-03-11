# Release Notes — v1.0.12

## Joint Axis Friction

**What it does:** Joint friction creates passive resistance on constraint axes (hinges, sliders, prismatic joints). When a motor is turned off, friction decelerates the joint instead of letting it coast forever. This is implemented using Rapier's motor system — a velocity motor targeting 0 with the friction value as the damping coefficient.

**How it works under the hood:** Rapier joints have no dedicated friction API. Instead, when motor type is `NONE` and friction > 0, the plugin calls `configureMotorVelocity(0, friction)` — a velocity motor with zero target and the friction value as damping. This produces a force proportional to velocity that opposes motion, which is exactly what friction does.

**Usage:**

```ts
// Set friction on a hinge constraint's angular axis
plugin.setAxisFriction(hingeConstraint, PhysicsConstraintAxis.ANGULAR_X, 20);
```

Friction is applied consistently across all three physics layers (local rapier, server, networked clients). When the motor type changes to `NONE`, friction automatically takes effect. When a motor is active (velocity or position), the motor's own damping is used instead.

**Reference values:**
- **0** — frictionless (previous default behavior, arm coasts indefinitely)
- **1–5** — very light friction, slow deceleration
- **10–30** — moderate friction, arm decelerates visibly over a few seconds
- **50–100** — heavy friction, arm stops quickly
- **500+** — near-instant stop

## Motor System Overhaul

The motor application logic was rewritten across all three layers to use a stateful `MotorConfig` tracked per joint. This fixes several issues with the previous implementation:

- **Independent updates** — changing `motorTarget`, `motorType`, `motorMaxForce`, or `friction` individually now works correctly. Previously, updating one property required re-sending all others because no config was tracked.
- **Proper motor neutralization** — setting motor type to `NONE` now fully clears the motor (`configureMotor(0,0,0,0)` + `setMotorMaxForce(0)`) unless friction is configured, preventing ghost forces from lingering.
- **Stiffness and damping parameters** — `ConstraintUpdates.axisUpdates` now supports `stiffness` and `damping` fields, allowing motor tuning over the network. Previously these were hardcoded.

## Constraint Update Buffering

Constraint updates (motor type, target, friction, max force) that are sent before the constraint creation message reaches the server are now buffered and replayed in order after creation. This fixes a race condition where rapid `addConstraint` → `setAxisMotorType` → `setAxisMotorTarget` sequences could drop the motor configuration because the server hadn't received the constraint yet.

## Demo: Hinge Motor with Toggle

Added a hinge motor demo to the scene — a green post with an orange arm spinning via a velocity motor at 3 rad/s. A **Motor: ON/OFF** button toggles the motor, demonstrating friction in action: when the motor is turned off, the arm decelerates to a stop instead of spinning freely.

## Test Suite

Added 15 new tests for the rapier constraint-ops module covering constraint lifecycle, axis configuration, motor application, and friction behavior. Total test count: 487 tests across 25 test files (all passing).

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| shared | `src/types.ts` | Added `stiffness`, `damping` fields to `ConstraintUpdates.axisUpdates` |
| server | `src/physics-world/pw-constraints.ts` | `MotorConfig` tracking, `applyMotor()` with friction, stateful `updateConstraint()` |
| client | `src/networked/constraint-ops.ts` | `MotorConfig` tracking, `applyMotor()` with friction, constraint update buffering, stateful `applyUpdatesToJoint()` |
| client | `src/rapier/constraint-ops.ts` | `setAxisFriction()` now applies to joint, `applyMotorToJoint()` rewritten with friction support |
| client | `src/rapier/__tests__/constraint-ops.test.ts` | New test suite (15 tests) |
| demo | `index.html` | Motor toggle button |
| demo | `src/main.ts` | Hinge motor demo, motor toggle, friction value = 10 |
