import { describe, it, expect } from 'vitest';
import {
  encodeMessage,
  decodeMessage,
  decodeClientMessage,
  decodeServerMessage,
  encodeRoomState,
  decodeRoomState,
  MessageType,
  FIELD_POSITION,
  FIELD_ROTATION,
  FIELD_LIN_VEL,
  FIELD_ANG_VEL,
  FIELD_ALL,
} from '../index.js';
import type { ClientMessage, ServerMessage, RoomStateMessage, CollisionEventsMessage } from '../index.js';

describe('serialization', () => {
  it('should round-trip a ClockSyncRequest message', () => {
    const message: ClientMessage = {
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp: 1234567890,
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = decodeClientMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip a ClockSyncResponse message', () => {
    const message: ServerMessage = {
      type: MessageType.CLOCK_SYNC_RESPONSE,
      clientTimestamp: 1234567890,
      serverTimestamp: 1234567900,
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = decodeServerMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip a RoomState message via binary codec (string IDs, full fields)', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 42,
      timestamp: Date.now(),
      bodies: [
        {
          id: 'body1',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 0.1, y: 0.2, z: 0.3 },
          angVel: { x: 0, y: 0, z: 0 },
        },
      ],
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded[0]).toBe(0x01);
    const decoded = decodeServerMessage(encoded) as RoomStateMessage;
    expect(decoded.type).toBe(MessageType.ROOM_STATE);
    expect(decoded.tick).toBe(42);
    expect(decoded.bodies.length).toBe(1);
    expect(decoded.bodies[0].id).toBe('body1');
    expect(decoded.bodies[0].position.x).toBeCloseTo(1, 5);
    expect(decoded.bodies[0].position.y).toBeCloseTo(2, 5);
    expect(decoded.bodies[0].position.z).toBeCloseTo(3, 5);
    // Rotation uses smallest-three: precision ~0.00003 per component
    expect(decoded.bodies[0].rotation.w).toBeCloseTo(1, 3);
    expect(decoded.bodies[0].linVel.x).toBeCloseTo(0.1, 5);
  });

  it('should use opcode 0x02 for non-ROOM_STATE messages (msgpack)', () => {
    const message: ServerMessage = {
      type: MessageType.ERROR,
      message: 'Something went wrong',
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded[0]).toBe(0x02);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip a ClientInput message', () => {
    const message: ClientMessage = {
      type: MessageType.CLIENT_INPUT,
      input: {
        tick: 10,
        sequenceNum: 3,
        actions: [
          {
            type: 'applyForce',
            bodyId: 'player1',
            data: { force: { x: 0, y: 10, z: 0 } },
          },
          {
            type: 'setVelocity',
            bodyId: 'player1',
            data: { linVel: { x: 5, y: 0, z: 0 } },
          },
        ],
      },
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = decodeClientMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip a CreateRoom message with bodies', () => {
    const message: ClientMessage = {
      type: MessageType.CREATE_ROOM,
      roomId: 'test-room',
      initialBodies: [
        {
          id: 'box1',
          shape: { type: 'box', params: { halfExtents: { x: 1, y: 1, z: 1 } } },
          motionType: 'dynamic',
          position: { x: 0, y: 5, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          mass: 1.0,
        },
      ],
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = decodeClientMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip generic decodeMessage for any message', () => {
    const message: ServerMessage = {
      type: MessageType.ERROR,
      message: 'Something went wrong',
    };
    const encoded = encodeMessage(message);
    const decoded = decodeMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should handle ROOM_STATE with multiple bodies', () => {
    // Use a normalized quaternion for smallest-three encoding accuracy
    const len = Math.sqrt(0.1*0.1 + 0.2*0.2 + 0.3*0.3 + 0.9*0.9);
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 100,
      timestamp: 1700000000000,
      bodies: [
        {
          id: 'a',
          position: { x: 1.5, y: -2.5, z: 3.5 },
          rotation: { x: 0.1/len, y: 0.2/len, z: 0.3/len, w: 0.9/len },
          linVel: { x: 10, y: 20, z: 30 },
          angVel: { x: -1, y: -2, z: -3 },
        },
        {
          id: 'longer-body-id-here',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 0, y: 0, z: 0 },
          angVel: { x: 0, y: 0, z: 0 },
        },
      ],
    };
    const encoded = encodeMessage(message);
    expect(encoded[0]).toBe(0x01);
    const decoded = decodeServerMessage(encoded) as RoomStateMessage;
    expect(decoded.tick).toBe(100);
    expect(decoded.bodies.length).toBe(2);
    expect(decoded.bodies[0].id).toBe('a');
    expect(decoded.bodies[1].id).toBe('longer-body-id-here');
    expect(decoded.bodies[0].position.x).toBeCloseTo(1.5, 5);
    expect(decoded.bodies[0].angVel.z).toBeCloseTo(-3, 5);
    // Rotation uses smallest-three: precision ~0.001 per component
    expect(decoded.bodies[0].rotation.x).toBeCloseTo(0.1/len, 2);
    expect(decoded.bodies[0].rotation.y).toBeCloseTo(0.2/len, 2);
    expect(decoded.bodies[0].rotation.z).toBeCloseTo(0.3/len, 2);
    expect(decoded.bodies[0].rotation.w).toBeCloseTo(0.9/len, 2);
    expect(decoded.bodies[1].rotation.w).toBeCloseTo(1, 3);
  });

  it('should handle ROOM_STATE with zero bodies', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 0,
      timestamp: 0,
      bodies: [],
    };
    const encoded = encodeMessage(message);
    expect(encoded[0]).toBe(0x01);
    // Header: 1 + 4 + 8 + 1 + 2 = 16 bytes
    expect(encoded.byteLength).toBe(16);
    const decoded = decodeServerMessage(encoded) as RoomStateMessage;
    expect(decoded.tick).toBe(0);
    expect(decoded.bodies.length).toBe(0);
  });
});

describe('binary codec with numeric IDs', () => {
  it('should encode/decode with numeric body ID mapping', () => {
    const idToIndex = new Map<string, number>([
      ['body-alpha', 0],
      ['body-beta', 1],
    ]);
    const indexToId = new Map<number, string>([
      [0, 'body-alpha'],
      [1, 'body-beta'],
    ]);

    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 55,
      timestamp: 1700000000000,
      isDelta: true,
      bodies: [
        {
          id: 'body-alpha',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 0.5, y: 0, z: 0 },
          angVel: { x: 0, y: 0, z: 0 },
        },
        {
          id: 'body-beta',
          position: { x: -1, y: -2, z: -3 },
          rotation: { x: 0, y: 0.7071, z: 0, w: 0.7071 },
          linVel: { x: 0, y: -9.8, z: 0 },
          angVel: { x: 1, y: 0, z: 0 },
        },
      ],
    };

    const encoded = encodeRoomState(message, idToIndex);
    const decoded = decodeRoomState(encoded, indexToId);

    expect(decoded.tick).toBe(55);
    expect(decoded.isDelta).toBe(true);
    expect(decoded.bodies.length).toBe(2);
    expect(decoded.bodies[0].id).toBe('body-alpha');
    expect(decoded.bodies[1].id).toBe('body-beta');
    expect(decoded.bodies[0].position.x).toBeCloseTo(1, 5);
    expect(decoded.bodies[1].linVel.y).toBeCloseTo(-9.8, 5);
  });

  it('should produce smaller output with numeric IDs vs string IDs', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [
        {
          id: 'a-long-body-identifier',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 0, y: 0, z: 0 },
          angVel: { x: 0, y: 0, z: 0 },
        },
      ],
    };

    const idToIndex = new Map([['a-long-body-identifier', 0]]);

    const withStrings = encodeRoomState(message);
    const withNumeric = encodeRoomState(message, idToIndex);

    // Numeric IDs should be smaller (2 bytes vs 1+22 bytes for the ID)
    expect(withNumeric.byteLength).toBeLessThan(withStrings.byteLength);
  });
});

describe('binary codec with field masks', () => {
  it('should encode only position when fieldMask = FIELD_POSITION', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 10,
      timestamp: Date.now(),
      isDelta: true,
      bodies: [
        {
          id: 'b',
          position: { x: 5, y: 6, z: 7 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 0, y: 0, z: 0 },
          angVel: { x: 0, y: 0, z: 0 },
          fieldMask: FIELD_POSITION,
        },
      ],
    };

    const fullMsg: RoomStateMessage = {
      ...message,
      bodies: [{ ...message.bodies[0], fieldMask: FIELD_ALL }],
    };

    const partial = encodeRoomState(message);
    const full = encodeRoomState(fullMsg);

    // Partial should be smaller: only 12 bytes of position vs 12+7+12+12=43 of all fields
    expect(partial.byteLength).toBeLessThan(full.byteLength);

    // Decode and check
    const decoded = decodeRoomState(partial);
    expect(decoded.bodies[0].fieldMask).toBe(FIELD_POSITION);
    expect(decoded.bodies[0].position.x).toBeCloseTo(5, 5);
    expect(decoded.bodies[0].position.y).toBeCloseTo(6, 5);
    expect(decoded.bodies[0].position.z).toBeCloseTo(7, 5);
    // Non-transmitted fields should be zero/identity defaults
    expect(decoded.bodies[0].linVel.x).toBe(0);
    expect(decoded.bodies[0].rotation.w).toBe(1); // identity default
  });

  it('should encode position+linVel when fieldMask = FIELD_POSITION | FIELD_LIN_VEL', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 20,
      timestamp: Date.now(),
      isDelta: true,
      bodies: [
        {
          id: 'c',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linVel: { x: 10, y: 20, z: 30 },
          angVel: { x: 0, y: 0, z: 0 },
          fieldMask: FIELD_POSITION | FIELD_LIN_VEL,
        },
      ],
    };

    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);

    expect(decoded.bodies[0].fieldMask).toBe(FIELD_POSITION | FIELD_LIN_VEL);
    expect(decoded.bodies[0].position.x).toBeCloseTo(1, 5);
    expect(decoded.bodies[0].linVel.y).toBeCloseTo(20, 5);
    expect(decoded.bodies[0].angVel.x).toBe(0);
  });

  it('should encode all fields when fieldMask = FIELD_ALL', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 30,
      timestamp: Date.now(),
      bodies: [
        {
          id: 'full',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
          linVel: { x: 4, y: 5, z: 6 },
          angVel: { x: 7, y: 8, z: 9 },
          fieldMask: FIELD_ALL,
        },
      ],
    };

    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);

    expect(decoded.bodies[0].position.x).toBeCloseTo(1, 5);
    expect(decoded.bodies[0].rotation.x).toBeCloseTo(0.1, 2);
    expect(decoded.bodies[0].linVel.x).toBeCloseTo(4, 5);
    expect(decoded.bodies[0].angVel.z).toBeCloseTo(9, 5);
  });
});

describe('smallest-three quaternion encoding', () => {
  it('should preserve identity quaternion', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [{
        id: 'q',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        linVel: { x: 0, y: 0, z: 0 },
        angVel: { x: 0, y: 0, z: 0 },
      }],
    };

    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);
    const r = decoded.bodies[0].rotation;

    expect(r.x).toBeCloseTo(0, 3);
    expect(r.y).toBeCloseTo(0, 3);
    expect(r.z).toBeCloseTo(0, 3);
    expect(r.w).toBeCloseTo(1, 3);
  });

  it('should preserve 90-degree rotation around Y axis', () => {
    // 90 deg Y rotation: (0, sin(45°), 0, cos(45°)) = (0, 0.7071, 0, 0.7071)
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [{
        id: 'q',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0.7071067811865476, z: 0, w: 0.7071067811865476 },
        linVel: { x: 0, y: 0, z: 0 },
        angVel: { x: 0, y: 0, z: 0 },
      }],
    };

    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);
    const r = decoded.bodies[0].rotation;

    expect(r.x).toBeCloseTo(0, 3);
    expect(r.y).toBeCloseTo(0.7071, 3);
    expect(r.z).toBeCloseTo(0, 3);
    expect(r.w).toBeCloseTo(0.7071, 3);
  });

  it('should preserve arbitrary normalized quaternion', () => {
    // Normalized quaternion
    const len = Math.sqrt(0.1*0.1 + 0.2*0.2 + 0.3*0.3 + 0.9*0.9);
    const qx = 0.1/len, qy = 0.2/len, qz = 0.3/len, qw = 0.9/len;

    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [{
        id: 'q',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: qx, y: qy, z: qz, w: qw },
        linVel: { x: 0, y: 0, z: 0 },
        angVel: { x: 0, y: 0, z: 0 },
      }],
    };

    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);
    const r = decoded.bodies[0].rotation;

    expect(r.x).toBeCloseTo(qx, 3);
    expect(r.y).toBeCloseTo(qy, 3);
    expect(r.z).toBeCloseTo(qz, 3);
    expect(r.w).toBeCloseTo(qw, 3);
  });

  it('should save 9 bytes per body vs float32 quaternion', () => {
    // With smallest-three: 7 bytes for rotation
    // With float32: 16 bytes for rotation
    // Difference: 9 bytes
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [{
        id: 'x',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        linVel: { x: 0, y: 0, z: 0 },
        angVel: { x: 0, y: 0, z: 0 },
        fieldMask: FIELD_ROTATION,
      }],
    };
    const encoded = encodeRoomState(message);
    // Header(16) + idLen(1) + id(1) + mask(1) + rotation(7) = 26
    expect(encoded.byteLength).toBe(26);
  });
});

describe('isDelta flag', () => {
  it('should encode and decode isDelta flag', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      isDelta: true,
      bodies: [],
    };
    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);
    expect(decoded.isDelta).toBe(true);
  });

  it('should default isDelta to false when not set', () => {
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 1,
      timestamp: Date.now(),
      bodies: [],
    };
    const encoded = encodeRoomState(message);
    const decoded = decodeRoomState(encoded);
    expect(decoded.isDelta).toBe(false);
  });
});

describe('legacy JSON fallback', () => {
  it('should decode a raw JSON-encoded message without opcode prefix', () => {
    const message: ClientMessage = {
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp: 1234567890,
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(message));
    const decoded = decodeClientMessage(jsonBytes);
    expect(decoded).toEqual(message);
  });

  it('should decode a JSON-encoded server message without opcode prefix', () => {
    const message: ServerMessage = {
      type: MessageType.ERROR,
      message: 'Something went wrong',
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(message));
    const decoded = decodeServerMessage(jsonBytes);
    expect(decoded).toEqual(message);
  });
});

describe('collision events serialization', () => {
  it('should round-trip a COLLISION_EVENTS message via msgpack', () => {
    const message: CollisionEventsMessage = {
      type: MessageType.COLLISION_EVENTS,
      tick: 42,
      events: [
        {
          bodyIdA: 'box1',
          bodyIdB: 'ground',
          type: 'COLLISION_STARTED',
          point: { x: 1.5, y: 0, z: -2.3 },
          normal: { x: 0, y: 1, z: 0 },
          impulse: 15.7,
        },
        {
          bodyIdA: 'sphere1',
          bodyIdB: 'trigger-zone',
          type: 'TRIGGER_ENTERED',
          point: null,
          normal: null,
          impulse: 0,
        },
      ],
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded[0]).toBe(0x02); // msgpack opcode
    const decoded = decodeServerMessage(encoded) as CollisionEventsMessage;
    expect(decoded.type).toBe(MessageType.COLLISION_EVENTS);
    expect(decoded.tick).toBe(42);
    expect(decoded.events).toHaveLength(2);
    expect(decoded.events[0].bodyIdA).toBe('box1');
    expect(decoded.events[0].bodyIdB).toBe('ground');
    expect(decoded.events[0].type).toBe('COLLISION_STARTED');
    expect(decoded.events[0].point).toEqual({ x: 1.5, y: 0, z: -2.3 });
    expect(decoded.events[0].normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(decoded.events[0].impulse).toBe(15.7);
    expect(decoded.events[1].type).toBe('TRIGGER_ENTERED');
    expect(decoded.events[1].point).toBeNull();
    expect(decoded.events[1].normal).toBeNull();
    expect(decoded.events[1].impulse).toBe(0);
  });

  it('should round-trip COLLISION_EVENTS with empty events array', () => {
    const message: CollisionEventsMessage = {
      type: MessageType.COLLISION_EVENTS,
      tick: 0,
      events: [],
    };
    const encoded = encodeMessage(message);
    const decoded = decodeServerMessage(encoded) as CollisionEventsMessage;
    expect(decoded.type).toBe(MessageType.COLLISION_EVENTS);
    expect(decoded.events).toHaveLength(0);
  });

  it('should round-trip all collision event types', () => {
    const types = ['COLLISION_STARTED', 'COLLISION_FINISHED', 'TRIGGER_ENTERED', 'TRIGGER_EXITED'] as const;
    for (const eventType of types) {
      const message: CollisionEventsMessage = {
        type: MessageType.COLLISION_EVENTS,
        tick: 1,
        events: [{
          bodyIdA: 'a',
          bodyIdB: 'b',
          type: eventType,
          point: null,
          normal: null,
          impulse: 0,
        }],
      };
      const encoded = encodeMessage(message);
      const decoded = decodeServerMessage(encoded) as CollisionEventsMessage;
      expect(decoded.events[0].type).toBe(eventType);
    }
  });
});
