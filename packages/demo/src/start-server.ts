import { loadRapier, ComputeBackend } from '@rapierphysicsplugin/shared';
import { PhysicsServer } from '@rapierphysicsplugin/server';

const backend = (process.env.PHYSICS_BACKEND as ComputeBackend) ?? ComputeBackend.WASM_SIMD;
const RAPIER = await loadRapier({ backend });

const server = new PhysicsServer(RAPIER);
await server.start(8080);

const roomManager = server.getRoomManager();

roomManager.createRoom('demo');

console.log('Demo room "demo" created (empty — bodies added via client messages)');
console.log('Waiting for clients...');

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});
