import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsServer } from '@rapierphysicsplugin/server';
import type { BodyDescriptor } from '@rapierphysicsplugin/shared';

await RAPIER.init();

const server = new PhysicsServer(RAPIER);
await server.start(8080);

const roomManager = server.getRoomManager();

// Ramp mesh data (triangular wedge)
const rampVertices = new Float32Array([
  -1, 0, -1,   // v0: bottom front-left
   1, 0, -1,   // v1: bottom front-right
   1, 0,  1,   // v2: bottom back-right
  -1, 0,  1,   // v3: bottom back-left
  -1, 1.5, -1, // v4: top front-left
  -1, 1.5,  1, // v5: top back-left
]);

const rampIndices = new Uint32Array([
  0, 2, 1,  // bottom
  0, 3, 2,  // bottom
  0, 4, 5,  // left wall
  0, 5, 3,  // left wall
  0, 1, 4,  // front triangle
  3, 5, 2,  // back triangle
  4, 1, 2,  // slope
  4, 2, 5,  // slope
]);

const initialBodies: BodyDescriptor[] = [
  // Static ground plane (large flat box at y=-0.5)
  {
    id: 'ground',
    shape: { type: 'box', params: { halfExtents: { x: 10, y: 0.5, z: 10 } } },
    motionType: 'static',
    position: { x: 0, y: -0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    friction: 0.8,
    restitution: 0.3,
  },
  // Dynamic box (1x1x1)
  {
    id: 'box-0',
    shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
    motionType: 'dynamic',
    position: { x: 0, y: 3, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1.0,
    restitution: 0.4,
    friction: 0.5,
  },
  // Dynamic sphere (radius 0.5)
  {
    id: 'sphere-0',
    shape: { type: 'sphere', params: { radius: 0.5 } },
    motionType: 'dynamic',
    position: { x: 2, y: 4, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1.0,
    restitution: 0.6,
    friction: 0.3,
  },
  // Dynamic capsule (halfHeight=0.5, radius=0.3, total height=1.6)
  // Slight tilt so it doesn't balance on its end cap
  {
    id: 'capsule-0',
    shape: { type: 'capsule', params: { halfHeight: 0.5, radius: 0.3 } },
    motionType: 'dynamic',
    position: { x: -2, y: 5, z: 0 },
    rotation: { x: 0.15, y: 0, z: 0.15, w: 0.98 },
    mass: 1.0,
    restitution: 0.3,
    friction: 0.5,
  },
  // Static mesh ramp (triangular wedge)
  {
    id: 'ramp',
    shape: { type: 'mesh', params: { vertices: rampVertices, indices: rampIndices } },
    motionType: 'static',
    position: { x: 4, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    friction: 0.8,
    restitution: 0.2,
  },
];

roomManager.createRoom('demo', initialBodies);

console.log('Demo room "demo" created with ground + box + sphere + capsule + mesh ramp');
console.log('Waiting for clients...');

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});
