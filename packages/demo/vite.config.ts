import { defineConfig } from 'vite';

export default defineConfig({
  server: {
      allowedHosts: ['localhost', 'rapier-client.flatearthdefense.com'],
    port: 5173,
  },
});
