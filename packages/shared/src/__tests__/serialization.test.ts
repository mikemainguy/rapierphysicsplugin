import { describe, it, expect } from 'vitest';
import {
  encodeMessage,
  decodeMessage,
  decodeClientMessage,
  decodeServerMessage,
  MessageType,
} from '../index.js';
import type { ClientMessage, ServerMessage } from '../index.js';

describe('serialization', () => {
  it('should round-trip a ClockSyncRequest message', () => {
    const message: ClientMessage = {
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp: 1234567890,
    };
    const encoded = encodeMessage(message);
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
    const decoded = decodeServerMessage(encoded);
    expect(decoded).toEqual(message);
  });

  it('should round-trip a RoomState message', () => {
    const message: ServerMessage = {
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
    const decoded = decodeServerMessage(encoded);
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
});
