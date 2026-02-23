import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Room, RoomManager } from '../room.js';
import type { BodyDescriptor } from '@rapierphysicsplugin/shared';

describe('Room', () => {
  let rapier: typeof RAPIER;

  beforeAll(async () => {
    await RAPIER.init();
    rapier = RAPIER;
  });

  function makeBox(id: string, y: number = 5): BodyDescriptor {
    return {
      id,
      shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
      motionType: 'dynamic',
      position: { x: 0, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      mass: 1.0,
    };
  }

  it('should create a room with initial bodies', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 5), makeBox('box2', 10)]);

    const snapshot = room.getSnapshot();
    expect(snapshot.bodies).toHaveLength(2);
    room.destroy();
  });

  it('should add and remove bodies', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1')]);

    const snapshot1 = room.getSnapshot();
    expect(snapshot1.bodies).toHaveLength(1);

    room.destroy();
  });

  it('should step physics and advance tick', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 10)]);

    expect(room.tickNumber).toBe(0);
    room.tick();
    expect(room.tickNumber).toBe(1);
    room.tick();
    expect(room.tickNumber).toBe(2);

    room.destroy();
  });

  it('should process buffered inputs during tick', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 5)]);

    // Simulate a client connection by directly buffering input
    // We need to add a mock client first
    const mockConn = {
      id: 'client1',
      roomId: null as string | null,
      ws: { readyState: 1, OPEN: 1, send: () => {} } as any,
      send: () => {},
      rtt: 0,
      clockOffset: 0,
      lastAcknowledgedTick: 0,
      inputSequence: 0,
      updateClockSync: () => {},
      mapClientTickToServerTick: () => 0,
    };

    room.addClient(mockConn as any);
    room.bufferInput('client1', {
      tick: 0,
      sequenceNum: 0,
      actions: [
        { type: 'applyImpulse', bodyId: 'box1', data: { impulse: { x: 10, y: 0, z: 0 } } },
      ],
    });

    room.tick();

    const state = room.getSnapshot();
    const box1 = state.bodies.find(b => b.id === 'box1')!;
    expect(box1.linVel.x).toBeGreaterThan(0);

    room.destroy();
  });

  it('should not auto-start simulation when a client joins', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 5)]);

    const mockConn = {
      id: 'client1',
      roomId: null as string | null,
      ws: { readyState: 1, OPEN: 1, send: () => {} } as any,
      send: () => {},
      rtt: 0,
      clockOffset: 0,
      lastAcknowledgedTick: 0,
      inputSequence: 0,
      updateClockSync: () => {},
      mapClientTickToServerTick: () => 0,
    };

    room.addClient(mockConn as any);
    expect(room.isSimulationRunning).toBe(false);

    room.destroy();
  });

  it('should start simulation on startSimulation call', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 5)]);

    const sentMessages: string[] = [];
    const mockConn = {
      id: 'client1',
      roomId: null as string | null,
      ws: { readyState: 1, OPEN: 1, send: () => {} } as any,
      send: (msg: string) => { sentMessages.push(msg); },
      rtt: 0,
      clockOffset: 0,
      lastAcknowledgedTick: 0,
      inputSequence: 0,
      updateClockSync: () => {},
      mapClientTickToServerTick: () => 0,
    };

    room.addClient(mockConn as any);
    expect(room.isSimulationRunning).toBe(false);

    room.startSimulation();
    expect(room.isSimulationRunning).toBe(true);

    // Should have broadcast SIMULATION_STARTED
    const startedMsg = sentMessages.find(m => m.includes('simulation_started'));
    expect(startedMsg).toBeDefined();

    room.destroy();
  });

  it('should reset physics on startSimulation when already running', () => {
    const room = new Room('test', rapier);
    room.loadInitialState([makeBox('box1', 10)]);

    const mockConn = {
      id: 'client1',
      roomId: null as string | null,
      ws: { readyState: 1, OPEN: 1, send: () => {} } as any,
      send: () => {},
      rtt: 0,
      clockOffset: 0,
      lastAcknowledgedTick: 0,
      inputSequence: 0,
      updateClockSync: () => {},
      mapClientTickToServerTick: () => 0,
    };

    room.addClient(mockConn as any);
    room.startSimulation();

    // Run some ticks so physics changes
    for (let i = 0; i < 60; i++) {
      room.tick();
    }
    expect(room.tickNumber).toBeGreaterThan(0);
    const stateBefore = room.getSnapshot();
    const box = stateBefore.bodies.find(b => b.id === 'box1')!;
    expect(box.position.y).not.toBeCloseTo(10);

    // Reset
    room.startSimulation();
    expect(room.tickNumber).toBe(0);
    const stateAfter = room.getSnapshot();
    const boxAfter = stateAfter.bodies.find(b => b.id === 'box1')!;
    expect(boxAfter.position.y).toBeCloseTo(10);

    room.destroy();
  });
});

describe('RoomManager', () => {
  let rapier: typeof RAPIER;

  beforeAll(async () => {
    await RAPIER.init();
    rapier = RAPIER;
  });

  it('should create and retrieve rooms', () => {
    const manager = new RoomManager(rapier);
    manager.createRoom('room1');

    expect(manager.getRoom('room1')).toBeDefined();
    expect(manager.roomCount).toBe(1);

    manager.destroyRoom('room1');
  });

  it('should throw on duplicate room creation', () => {
    const manager = new RoomManager(rapier);
    manager.createRoom('room1');
    expect(() => manager.createRoom('room1')).toThrow('already exists');
    manager.destroyRoom('room1');
  });

  it('should destroy rooms', () => {
    const manager = new RoomManager(rapier);
    manager.createRoom('room1');
    manager.destroyRoom('room1');
    expect(manager.getRoom('room1')).toBeUndefined();
    expect(manager.roomCount).toBe(0);
  });

  it('should list all room ids', () => {
    const manager = new RoomManager(rapier);
    manager.createRoom('room1');
    manager.createRoom('room2');

    expect(manager.getAllRoomIds().sort()).toEqual(['room1', 'room2']);

    manager.destroyRoom('room1');
    manager.destroyRoom('room2');
  });
});
