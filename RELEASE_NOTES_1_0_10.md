# Release Notes — v1.0.10

## New Shape Types

Added full client-to-server support for four additional physics shape types:

- **Cylinder** (`PhysicsShapeType.CYLINDER`) — networked cylinder colliders with configurable half-height and radius
- **Convex Hull** (`PhysicsShapeType.CONVEX_HULL`) — arbitrary convex mesh colliders built from vertex data (e.g. cones)
- **Heightfield** (`PhysicsShapeType.HEIGHTFIELD`) — terrain colliders with support for `PhysicsShapeGroundMesh` auto-extraction of height samples, dimensions, and bounding box
- **Container** (`PhysicsShapeType.CONTAINER`) — compound shapes with multiple child colliders, each with optional translation and rotation offsets

These shape types are now serialized over the network, replicated on the server, and broadcast to late-joining clients.

## msgpackr Typed Array Serialization Fix

**Root cause:** `msgpackr.pack()` does not natively handle `Float32Array` or `Uint32Array`. It was silently corrupting float data by copying element values as bytes (e.g. `1.5` became `0x01`) and producing unaligned buffers that caused `RangeError` on reconstruction.

**Fix:** Registered custom msgpackr extensions (types `0x14` and `0x15`) in `packages/shared/src/serialization.ts` that:
- **Pack:** extract raw bytes via `new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)`
- **Unpack:** copy into an aligned `ArrayBuffer` before constructing the typed array

This eliminates the `Server error: expected instance of OA` errors that occurred when spawning convex hull shapes (cones) and other geometry-based bodies.

## Server-Side Safety Nets

Updated `toFloat32Array` and `toUint32Array` helpers in the server's `PhysicsWorld` to:
- Copy into aligned buffers instead of creating views (fixes `RangeError` from non-aligned `byteOffset`)
- Handle `Array` inputs explicitly for cases where data arrives as plain arrays

## Client Plugin Improvements

- **Cylinder shape serialization** — `shapeInfoToDescriptor` now handles `PhysicsShapeType.CYLINDER`
- **Convex hull serialization** — extracts vertex positions from mesh data and sends as `Float32Array`
- **Heightfield serialization** — supports both explicit height data and `groundMesh` auto-extraction
- **Container/compound shape serialization** — recursively serializes child shapes with transforms
- **Shape cast queries** — `ConvexPolyhedron`, `TriMesh`, and `HeightField` shapes now return proper bounding boxes via Rapier's `aabb()` method
- **Failed body serialization** — bodies that can't be serialized are now unregistered with a console error instead of silently freezing
- **Raw shape data caching** — vertex/index data stored in `shapeRawData` map for shape-cast query support

## Demo

- Added **Cylinder** and **Cone** spawn controls to the UI panel
- Cones use `PhysicsShapeType.CONVEX_HULL` with a tapered cylinder mesh

## Server Debugging

Added diagnostic logging in the server for typed array inspection:
- `[ADD_BODY]` logs shape type and param types for convex_hull, mesh, heightfield, and container shapes
- `[createColliderDesc]` logs type info before and after conversion
- `[toFloat32Array]`/`[toUint32Array]` logs which conversion path is taken

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| shared | `src/serialization.ts` | msgpackr Float32Array/Uint32Array extensions |
| shared | `src/types.ts` | New shape types and interfaces |
| server | `src/physics-world.ts` | Collider desc factory, aligned typed array helpers, container support, debug logging |
| server | `src/server.ts` | ADD_BODY debug logging |
| client | `src/networked-body-ops.ts` | Cylinder, convex hull, heightfield, container serialization |
| client | `src/rapier-plugin.ts` | Shape raw data cache, convex hull query shapes |
| client | `src/rapier-shape-ops.ts` | Heightfield ground mesh extraction, raw data caching, AABB for complex shapes |
| client | `src/rapier-types.ts` | `ShapeRawData` interface, `shapeRawData` on plugin state |
| demo | `index.html` | Cylinder and cone spawn inputs |
| demo | `src/main.ts` | Cylinder and cone spawn logic |
