# Rapier Physics Plugin

A networked physics synchronization system built on [Rapier](https://rapier.rs/) (WASM) and [BabylonJS](https://www.babylonjs.com/). The server runs an authoritative Rapier physics simulation and broadcasts state to connected browser clients over WebSocket, where bodies are rendered with interpolated 60Hz motion.

## Project Structure

```
packages/
  shared/   — Types, protocol definitions, serialization (used by all packages)
  server/   — Authoritative physics server (Rapier + WebSocket)
  client/   — BabylonJS plugin, sync client, interpolation, clock sync
  demo/     — Browser demo (Vite + BabylonJS) and demo physics server setup
```

## Prerequisites

- **Node.js** v20+ (developed on v22)
- **npm** (ships with Node)

## Quick Start

```bash
# 1. Install dependencies (npm workspaces handles all packages)
npm install

# 2. Build all packages (shared must build before server/client)
npm run build

# 3. Start the demo physics server (port 8080)
npm run server --workspace=packages/demo

# 4. In a second terminal, start the Vite dev server (port 5173)
npm run dev --workspace=packages/demo

# 5. Open http://localhost:5173 in your browser
```

## Build

```bash
# Build everything
npm run build

# Build individual packages
npm run build --workspace=packages/shared
npm run build --workspace=packages/server
npm run build --workspace=packages/client
```

Build order matters: **shared** must be built before **server** and **client**, since both depend on it. The demo has no build step (Vite serves it directly).

After modifying `packages/client/src/` or `packages/shared/src/`, rebuild those packages and clear Vite's cache for the demo to pick up changes:

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/client
rm -rf packages/demo/node_modules/.vite
```

## Tests

```bash
npm test
```

Runs all tests via [Vitest](https://vitest.dev/) across all packages (shared serialization, client interpolation/reconciliation, server physics/rooms/integration).

## Demo Features

- **Real-time physics** — server steps Rapier at 60Hz, broadcasts delta state at 20Hz
- **Client interpolation** — Hermite spline interpolation at 60Hz render rate with velocity hints
- **Spawn bodies** — add boxes, spheres, and capsules via the UI panel
- **Apply impulses** — click any dynamic body to launch it upward
- **Constraint demos** — ball-and-socket, hinge, rope, slider, lock, spring, and 6-DOF joints with debug visualization
- **Collision events** — server-authoritative collision detection with client-side event counter
- **Clock sync** — rolling RTT/offset estimation for accurate interpolation timing
- **Debug overlay** — FPS, tick, RTT, clock offset, body counts, interpolation stats, bandwidth

## Architecture

```
Server (60Hz physics, 20Hz broadcast)
  └─ WebSocket ──► Client
                     ├─ ClockSyncClient (RTT + offset estimation)
                     ├─ StateReconciler (feeds snapshots to interpolator)
                     ├─ Interpolator (Hermite spline + SLERP, 150ms render buffer)
                     └─ Render loop (60Hz) queries interpolator ──► BabylonJS meshes
```

The server is fully authoritative. Clients have no local physics simulation — they receive state snapshots and interpolate between them for smooth rendering.

## Usage Guide

See the [Usage Guide](https://github.com/mikemainguy/rapierphysicsplugin/blob/main/USAGE.md) for detailed documentation on all features, including bodies, shapes, constraints, motors, friction, collision events, queries, networking, differences from Havok, and known limitations.

## Release Notes

- [v1.0.12](https://github.com/mikemainguy/rapierphysicsplugin/blob/main/RELEASE_NOTES_1_0_12.md) — Joint axis friction, motor system overhaul, constraint update buffering, hinge motor demo
- [v1.0.11](https://github.com/mikemainguy/rapierphysicsplugin/blob/main/RELEASE_NOTES_1_0_11.md) — Fix heightfield nrows/ncols axis swap and column-major storage order
- [v1.0.10](https://github.com/mikemainguy/rapierphysicsplugin/blob/main/RELEASE_NOTES_1_0_10.md) — Cylinder, convex hull, heightfield, and container shapes; msgpackr typed array serialization fix
