import type RAPIER from '@dimforge/rapier3d-compat';
import { ComputeBackend, type ComputeConfig } from './constants.js';

/**
 * Detect whether the current runtime supports WebAssembly SIMD instructions.
 */
export function detectSIMDSupport(): boolean {
  try {
    // Minimal WASM module that uses a v128.const SIMD instruction.
    // If WebAssembly.validate accepts it, the runtime has SIMD support.
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/**
 * Dynamically load Rapier, selecting SIMD or compat build based on config.
 *
 * Both builds use the "-compat" packaging (base64-embedded WASM, init() function)
 * so they work identically in Node.js and browsers with no bundler workarounds.
 *
 * When WASM_SIMD is requested but unavailable (package not installed or runtime
 * lacks SIMD support), falls back to the compat build with a console warning.
 */
export async function loadRapier(
  config: ComputeConfig = { backend: ComputeBackend.WASM_COMPAT },
): Promise<typeof RAPIER> {
  if (config.backend === ComputeBackend.WASM_SIMD) {
    try {
      const simd = await import('@dimforge/rapier3d-simd-compat');
      await simd.default.init();
      console.log('[rapier-loader] Loaded WASM-SIMD backend');
      return simd.default as unknown as typeof RAPIER;
    } catch (err) {
      console.warn('[rapier-loader] SIMD backend unavailable, falling back to compat:', err);
    }
  }

  const compat = await import('@dimforge/rapier3d-compat');
  await compat.default.init();
  console.log('[rapier-loader] Loaded WASM-compat backend');
  return compat.default;
}
