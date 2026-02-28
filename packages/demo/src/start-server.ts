import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsServer } from '@rapierphysicsplugin/server';
import type { BodyDescriptor, ConstraintDescriptor } from '@rapierphysicsplugin/shared';

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

  // ===== Constraint demo bodies =====

  // --- Ball & Socket (Pendulum) at x=-7, z=-5 ---
  {
    id: 'anchor-pendulum',
    shape: { type: 'sphere', params: { radius: 0.15 } },
    motionType: 'static',
    position: { x: -7, y: 5, z: -5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: 'pendulum-ball',
    shape: { type: 'sphere', params: { radius: 0.4 } },
    motionType: 'dynamic',
    position: { x: -7, y: 3, z: -5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 2,
    friction: 0.5,
    restitution: 0.3,
  },

  // --- Hinge (Door) at x=-7, z=0 ---
  {
    id: 'anchor-hinge',
    shape: { type: 'box', params: { halfExtents: { x: 0.1, y: 1, z: 0.1 } } },
    motionType: 'static',
    position: { x: -7, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: 'hinge-door',
    shape: { type: 'box', params: { halfExtents: { x: 1.0, y: 0.8, z: 0.08 } } },
    motionType: 'dynamic',
    position: { x: -6, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0.1,
  },

  // --- Distance / Rope at x=-7, z=5 ---
  {
    id: 'rope-top',
    shape: { type: 'sphere', params: { radius: 0.3 } },
    motionType: 'static',
    position: { x: -7, y: 5, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: 'rope-bottom',
    shape: { type: 'sphere', params: { radius: 0.3 } },
    motionType: 'dynamic',
    position: { x: -7, y: 2, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1.5,
    friction: 0.5,
    restitution: 0.5,
  },

  // --- Prismatic / Slider at x=0, z=-7 ---
  {
    id: 'anchor-slider',
    shape: { type: 'box', params: { halfExtents: { x: 0.15, y: 0.15, z: 0.15 } } },
    motionType: 'static',
    position: { x: 0, y: 1.5, z: -7 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: 'slider-box',
    shape: { type: 'box', params: { halfExtents: { x: 0.35, y: 0.35, z: 0.35 } } },
    motionType: 'dynamic',
    position: { x: 1.5, y: 1.5, z: -7 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.2,
    restitution: 0.3,
  },

  // --- Lock (Fixed) at x=0, z=7 ---
  {
    id: 'lock-a',
    shape: { type: 'box', params: { halfExtents: { x: 0.4, y: 0.4, z: 0.4 } } },
    motionType: 'dynamic',
    position: { x: 0, y: 5, z: 7 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
  },
  {
    id: 'lock-b',
    shape: { type: 'box', params: { halfExtents: { x: 0.4, y: 0.4, z: 0.4 } } },
    motionType: 'dynamic',
    position: { x: 0.8, y: 5, z: 7 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
  },

  // --- Spring at x=7, z=-5 ---
  {
    id: 'anchor-spring',
    shape: { type: 'sphere', params: { radius: 0.15 } },
    motionType: 'static',
    position: { x: 7, y: 6, z: -5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: 'spring-ball',
    shape: { type: 'sphere', params: { radius: 0.4 } },
    motionType: 'dynamic',
    position: { x: 7, y: 3, z: -5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
  },

  // --- 6-DOF (Limited rotation) at x=7, z=5 ---
  {
    id: 'anchor-6dof',
    shape: { type: 'box', params: { halfExtents: { x: 0.15, y: 0.15, z: 0.15 } } },
    motionType: 'static',
    position: { x: 7, y: 3, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
  {
    id: '6dof-box',
    shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.3, z: 0.5 } } },
    motionType: 'dynamic',
    position: { x: 7, y: 2, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
  },
];

const initialConstraints: ConstraintDescriptor[] = [
  // Ball & Socket — pendulum swings freely around anchor
  {
    id: 'c-pendulum',
    bodyIdA: 'anchor-pendulum',
    bodyIdB: 'pendulum-ball',
    type: 'ball_and_socket',
    pivotA: { x: 0, y: 0, z: 0 },
    pivotB: { x: 0, y: 2, z: 0 },
    collision: false,
  },

  // Hinge — door rotates around Y axis at the post
  {
    id: 'c-hinge',
    bodyIdA: 'anchor-hinge',
    bodyIdB: 'hinge-door',
    type: 'hinge',
    pivotA: { x: 0.1, y: 0, z: 0 },
    pivotB: { x: -1.0, y: 0, z: 0 },
    axisA: { x: 0, y: 1, z: 0 },
    collision: false,
  },

  // Distance / Rope — bottom sphere hangs within max distance of top
  {
    id: 'c-rope',
    bodyIdA: 'rope-top',
    bodyIdB: 'rope-bottom',
    type: 'distance',
    pivotA: { x: 0, y: 0, z: 0 },
    pivotB: { x: 0, y: 0, z: 0 },
    maxDistance: 3,
    collision: false,
  },

  // Prismatic / Slider — box slides along X axis from anchor
  {
    id: 'c-slider',
    bodyIdA: 'anchor-slider',
    bodyIdB: 'slider-box',
    type: 'prismatic',
    pivotA: { x: 0, y: 0, z: 0 },
    pivotB: { x: 0, y: 0, z: 0 },
    axisA: { x: 1, y: 0, z: 0 },
    collision: false,
  },

  // Lock / Fixed — two boxes rigidly attached, falling together
  {
    id: 'c-lock',
    bodyIdA: 'lock-a',
    bodyIdB: 'lock-b',
    type: 'lock',
    pivotA: { x: 0.4, y: 0, z: 0 },
    pivotB: { x: -0.4, y: 0, z: 0 },
    axisA: { x: 1, y: 0, z: 0 },
    axisB: { x: 1, y: 0, z: 0 },
    collision: false,
  },

  // Spring — ball bounces on spring from ceiling anchor
  {
    id: 'c-spring',
    bodyIdA: 'anchor-spring',
    bodyIdB: 'spring-ball',
    type: 'spring',
    pivotA: { x: 0, y: 0, z: 0 },
    pivotB: { x: 0, y: 0, z: 0 },
    maxDistance: 3,
    stiffness: 30,
    damping: 1,
    collision: false,
  },

  // 6-DOF — box hangs from anchor with limited angular freedom
  {
    id: 'c-6dof',
    bodyIdA: 'anchor-6dof',
    bodyIdB: '6dof-box',
    type: 'six_dof',
    pivotA: { x: 0, y: 0, z: 0 },
    pivotB: { x: 0, y: 1, z: 0 },
    axisA: { x: 0, y: 1, z: 0 },
    limits: [
      { axis: 0, minLimit: 0, maxLimit: 0 },     // LINEAR_X locked
      { axis: 1, minLimit: 0, maxLimit: 0 },     // LINEAR_Y locked
      { axis: 2, minLimit: 0, maxLimit: 0 },     // LINEAR_Z locked
      { axis: 3, minLimit: -0.5, maxLimit: 0.5 }, // ANGULAR_X limited
      { axis: 4, minLimit: -0.5, maxLimit: 0.5 }, // ANGULAR_Y limited
      { axis: 5 },                                // ANGULAR_Z free
    ],
    collision: false,
  },
];

roomManager.createRoom('demo', initialBodies, undefined, initialConstraints);

console.log('Demo room "demo" created with:');
console.log('  - Ground + ramp');
console.log('  - 7 constraint demos: ball_and_socket, hinge, distance, prismatic, lock, spring, 6dof');
console.log('Waiting for clients...');

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});
