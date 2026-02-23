import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_PORT } from '@havokserver/shared';
import { PhysicsServer } from './server.js';

export { PhysicsServer } from './server.js';
export { PhysicsWorld } from './physics-world.js';
export { Room, RoomManager } from './room.js';
export { ClientConnection } from './client-connection.js';
export { SimulationLoop } from './simulation-loop.js';
export { StateManager } from './state-manager.js';
export { InputBuffer } from './input-buffer.js';

async function main(): Promise<void> {
  console.log('Initializing Rapier WASM...');
  await RAPIER.init();
  console.log('Rapier initialized.');

  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const server = new PhysicsServer(RAPIER);
  await server.start(port);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.stop();
    process.exit(0);
  });
}

// Only run main when executed directly
const isMainModule = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMainModule) {
  main().catch(console.error);
}
