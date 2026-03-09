import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomManager } from '../room-manager.js';
import type { BodyDescriptor, ConstraintDescriptor } from '@rapierphysicsplugin/shared';

describe('RoomManager', () => {
  let rapier: typeof RAPIER;
  let manager: RoomManager;

  beforeAll(async () => {
    await RAPIER.init();
    rapier = RAPIER;
  });

  afterEach(() => {
    // Clean up any rooms left over from tests
    for (const id of manager.getAllRoomIds()) {
      manager.destroyRoom(id);
    }
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

  describe('createRoom', () => {
    it('should create a room and return it', () => {
      manager = new RoomManager(rapier);
      const room = manager.createRoom('room1');

      expect(room).toBeDefined();
      expect(room.id).toBe('room1');
    });

    it('should throw when creating a room with a duplicate id', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');

      expect(() => manager.createRoom('room1')).toThrow('Room "room1" already exists');
    });

    it('should create a room with initial bodies', () => {
      manager = new RoomManager(rapier);
      const bodies = [makeBox('box1', 5), makeBox('box2', 10)];
      const room = manager.createRoom('room1', bodies);

      const snapshot = room.getSnapshot();
      expect(snapshot.bodies).toHaveLength(2);
      expect(snapshot.bodies.map(b => b.id).sort()).toEqual(['box1', 'box2']);
    });

    it('should create a room with custom gravity', () => {
      manager = new RoomManager(rapier);
      const gravity = { x: 0, y: -20, z: 0 };
      const room = manager.createRoom('room1', [], gravity);

      // Verify room was created; gravity is applied internally
      expect(room).toBeDefined();
      expect(room.id).toBe('room1');
    });

    it('should create a room with initial constraints', () => {
      manager = new RoomManager(rapier);
      const bodies = [makeBox('box1', 5), makeBox('box2', 10)];
      const constraints: ConstraintDescriptor[] = [
        {
          id: 'c1',
          bodyIdA: 'box1',
          bodyIdB: 'box2',
          type: 'lock',
          pivotA: { x: 0, y: 0.5, z: 0 },
          pivotB: { x: 0, y: -0.5, z: 0 },
        },
      ];
      const room = manager.createRoom('room1', bodies, undefined, constraints);

      const snapshot = room.getSnapshot();
      expect(snapshot.bodies).toHaveLength(2);
      // Constraint was loaded without error; bodies are linked via a lock joint
      expect(room).toBeDefined();
    });

    it('should create a room with no initial bodies or constraints', () => {
      manager = new RoomManager(rapier);
      const room = manager.createRoom('empty');

      const snapshot = room.getSnapshot();
      expect(snapshot.bodies).toHaveLength(0);
    });
  });

  describe('getRoom', () => {
    it('should return the room when it exists', () => {
      manager = new RoomManager(rapier);
      const created = manager.createRoom('room1');
      const retrieved = manager.getRoom('room1');

      expect(retrieved).toBe(created);
    });

    it('should return undefined for a non-existent room', () => {
      manager = new RoomManager(rapier);

      expect(manager.getRoom('nonexistent')).toBeUndefined();
    });
  });

  describe('destroyRoom', () => {
    it('should remove the room and clean up', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');

      manager.destroyRoom('room1');

      expect(manager.getRoom('room1')).toBeUndefined();
      expect(manager.roomCount).toBe(0);
    });

    it('should be a no-op for a non-existent room', () => {
      manager = new RoomManager(rapier);

      // Should not throw
      manager.destroyRoom('nonexistent');
      expect(manager.roomCount).toBe(0);
    });

    it('should only remove the targeted room', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');
      manager.createRoom('room2');

      manager.destroyRoom('room1');

      expect(manager.getRoom('room1')).toBeUndefined();
      expect(manager.getRoom('room2')).toBeDefined();
      expect(manager.roomCount).toBe(1);
    });
  });

  describe('roomCount', () => {
    it('should return 0 when no rooms exist', () => {
      manager = new RoomManager(rapier);

      expect(manager.roomCount).toBe(0);
    });

    it('should track the number of rooms', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');
      expect(manager.roomCount).toBe(1);

      manager.createRoom('room2');
      expect(manager.roomCount).toBe(2);

      manager.createRoom('room3');
      expect(manager.roomCount).toBe(3);

      manager.destroyRoom('room2');
      expect(manager.roomCount).toBe(2);
    });
  });

  describe('getAllRoomIds', () => {
    it('should return an empty array when no rooms exist', () => {
      manager = new RoomManager(rapier);

      expect(manager.getAllRoomIds()).toEqual([]);
    });

    it('should return all room ids', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('alpha');
      manager.createRoom('beta');
      manager.createRoom('gamma');

      expect(manager.getAllRoomIds().sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('should reflect rooms after destruction', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');
      manager.createRoom('room2');
      manager.destroyRoom('room1');

      expect(manager.getAllRoomIds()).toEqual(['room2']);
    });
  });

  describe('lifecycle', () => {
    it('should allow re-creating a room after it was destroyed', () => {
      manager = new RoomManager(rapier);
      manager.createRoom('room1');
      manager.destroyRoom('room1');

      const room = manager.createRoom('room1');
      expect(room).toBeDefined();
      expect(manager.roomCount).toBe(1);
    });

    it('should manage multiple rooms independently', () => {
      manager = new RoomManager(rapier);
      const room1 = manager.createRoom('room1', [makeBox('box1')]);
      const room2 = manager.createRoom('room2', [makeBox('box2'), makeBox('box3')]);

      expect(room1.getSnapshot().bodies).toHaveLength(1);
      expect(room2.getSnapshot().bodies).toHaveLength(2);

      room1.tick();
      expect(room1.tickNumber).toBe(1);
      expect(room2.tickNumber).toBe(0);
    });
  });
});
