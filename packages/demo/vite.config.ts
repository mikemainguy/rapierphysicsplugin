import { defineConfig } from 'vite';

export default defineConfig({
  server: {
      allowedHosts: ['localhost', 'rapier-client.flatearthdefense.com'],
    port: 5173,
  },
  resolve: {
    dedupe: ['@babylonjs/core', '@dimforge/rapier3d-compat'],
  },
  optimizeDeps: {
    include: ['@babylonjs/core', '@dimforge/rapier3d-compat'],
  },
});
