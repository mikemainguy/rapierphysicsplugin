import { describe, it, expect } from 'vitest';
import {
  encodeMessage,
  decodeMessage,
  decodeClientMessage,
  decodeServerMessage,
  MessageType,
} from '../index.js';
import type { ClientMessage, ServerMessage, RoomStateMessage } from '../index.js';

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

  it('should round-trip a RoomState message via custom binary codec', () => {
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
    // Verify opcode is 0x01 for ROOM_STATE
    expect(encoded[0]).toBe(0x01);
    const decoded = decodeServerMessage(encoded);
    expect(decoded.type).toBe(MessageType.ROOM_STATE);
    const roomState = decoded as RoomStateMessage;
    expect(roomState.tick).toBe(42);
    expect(roomState.bodies.length).toBe(1);
    expect(roomState.bodies[0].id).toBe('body1');
    // Float32 precision: values should be close but not necessarily exact
    expect(roomState.bodies[0].position.x).toBeCloseTo(1, 5);
    expect(roomState.bodies[0].position.y).toBeCloseTo(2, 5);
    expect(roomState.bodies[0].position.z).toBeCloseTo(3, 5);
    expect(roomState.bodies[0].rotation.w).toBeCloseTo(1, 5);
    expect(roomState.bodies[0].linVel.x).toBeCloseTo(0.1, 5);
  });

  it('should use opcode 0x02 for non-ROOM_STATE messages (msgpack)', () => {
    const message: ServerMessage = {
      type: MessageType.ERROR,
      message: 'Something went wrong',
    };
    const encoded = encodeMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    // Verify opcode is 0x02 for msgpack
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
    const message: RoomStateMessage = {
      type: MessageType.ROOM_STATE,
      tick: 100,
      timestamp: 1700000000000,
      bodies: [
        {
          id: 'a',
          position: { x: 1.5, y: -2.5, z: 3.5 },
          rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
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
    expect(decoded.bodies[1].rotation.w).toBeCloseTo(1, 5);
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
    // Header only: 1 + 4 + 8 + 2 = 15 bytes
    expect(encoded.byteLength).toBe(15);
    const decoded = decodeServerMessage(encoded) as RoomStateMessage;
    expect(decoded.tick).toBe(0);
    expect(decoded.bodies.length).toBe(0);
  });
});
