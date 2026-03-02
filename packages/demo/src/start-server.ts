import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsServer } from '@rapierphysicsplugin/server';

await RAPIER.init();

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
