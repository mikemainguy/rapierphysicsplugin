# Release Notes — v1.0.11

## Heightfield nrows/ncols Axis Swap Fix

**Root cause:** Rapier's heightfield API defines `nrows` as cells along the **Z axis** and `ncols` as cells along the **X axis**, with heights stored in **column-major** order (element at row=z, col=x is `heights[x * (nrows+1) + z]`). The plugin had these swapped — `nrows` was set from X samples and `ncols` from Z samples — and heights were stored in row-major order. This caused the heightfield to be transposed, making shapes sink below or protrude through the terrain surface.

**Fix:** Corrected all heightfield creation sites to use the proper axis mapping and column-major storage:

- **Height extraction loops** now store in column-major order: `heights[x * subdivZ + z]` (was `heights[z * subdivX + x]`)
- **nrows/ncols** are now correctly assigned: `nrows = numSamplesZ - 1` (Z cells), `ncols = numSamplesX - 1` (X cells)
- **Debug visualization** (`_heightfieldGeo`) updated to match the new axis mapping and data layout

### Previously Applied (kept)

- CCD enabled on dynamic bodies
- `HeightFieldFlags.FIX_INTERNAL_EDGES` on all heightfield creation sites
- Z-flip (`bjsRow = (subdivZ - 1) - z`) in BabylonJS-to-Rapier height extraction

## Files Changed

| Package | File | Summary |
|---------|------|---------|
| client | `src/rapier-shape-ops.ts` | Column-major height storage + nrows/ncols swap |
| client | `src/networked-body-ops.ts` | Column-major height storage in network serialization |
| client | `src/rapier-plugin.ts` | `_heightfieldGeo` visualization matches new axis mapping |
| server | `src/physics-world.ts` | nrows/ncols swap in `createColliderDesc` heightfield case |
