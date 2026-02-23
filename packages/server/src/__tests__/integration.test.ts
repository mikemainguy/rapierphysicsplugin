import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { WebSocket } from 'ws';
import { PhysicsServer } from '../server.js';
import {
  MessageType,
  encodeMessage,
  decodeServerMessage,
} from '@havokserver/shared';
import type { ServerMessage, RoomJoinedMessage, RoomStateMessage } from '@havokserver/shared';

const TEST_PORT = 9876;

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, type: MessageType, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);

    const handler = (data: Buffer) => {
      const msg = decodeServerMessage(data.toString());
      if (msg.type === type) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('Integration: Server with WebSocket clients', () => {
  let server: PhysicsServer;

  beforeAll(async () => {
    await RAPIER.init();
  });

  afterEach(() => {
    server?.stop();
  });

  it('should allow a client to create and join a room', async () => {
    server = new PhysicsServer(RAPIER);
    await server.start(TEST_PORT);

    const ws = await connectClient(TEST_PORT);

    // Create room
    ws.send(encodeMessage({
      type: MessageType.CREATE_ROOM,
      roomId: 'test-room',
      initialBodies: [
        {
          id: 'box1',
          shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
          motionType: 'dynamic',
          position: { x: 0, y: 5, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          mass: 1.0,
        },
      ],
    }));

    const created = await waitForMessage(ws, MessageType.ROOM_CREATED);
    expect(created.type).toBe(MessageType.ROOM_CREATED);

    // Join room
    ws.send(encodeMessage({
      type: MessageType.JOIN_ROOM,
      roomId: 'test-room',
    }));

    const joined = await waitForMessage(ws, MessageType.ROOM_JOINED) as RoomJoinedMessage;
    expect(joined.roomId).toBe('test-room');
    expect(joined.snapshot.bodies).toHaveLength(1);
    expect(joined.snapshot.bodies[0].id).toBe('box1');

    ws.close();
  });

  it('should send state updates after joining a room', async () => {
    server = new PhysicsServer(RAPIER);
    await server.start(TEST_PORT + 1);

    const ws = await connectClient(TEST_PORT + 1);

    ws.send(encodeMessage({
      type: MessageType.CREATE_ROOM,
      roomId: 'state-room',
      initialBodies: [
        {
          id: 'ball',
          shape: { type: 'sphere', params: { radius: 0.5 } },
          motionType: 'dynamic',
          position: { x: 0, y: 10, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          mass: 1.0,
        },
      ],
    }));
    await waitForMessage(ws, MessageType.ROOM_CREATED);

    ws.send(encodeMessage({
      type: MessageType.JOIN_ROOM,
      roomId: 'state-room',
    }));
    await waitForMessage(ws, MessageType.ROOM_JOINED);

    // Wait for a state update — should arrive within a few seconds
    const stateMsg = await waitForMessage(ws, MessageType.ROOM_STATE) as RoomStateMessage;
    expect(stateMsg.tick).toBeGreaterThan(0);
    expect(stateMsg.bodies.length).toBeGreaterThanOrEqual(1);

    ws.close();
  });

  it('should allow two clients to share a room', async () => {
    server = new PhysicsServer(RAPIER);
    await server.start(TEST_PORT + 2);

    const ws1 = await connectClient(TEST_PORT + 2);
    const ws2 = await connectClient(TEST_PORT + 2);

    // Client 1 creates room
    ws1.send(encodeMessage({
      type: MessageType.CREATE_ROOM,
      roomId: 'shared-room',
      initialBodies: [
        {
          id: 'shared-box',
          shape: { type: 'box', params: { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } } },
          motionType: 'dynamic',
          position: { x: 0, y: 5, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          mass: 1.0,
        },
      ],
    }));
    await waitForMessage(ws1, MessageType.ROOM_CREATED);

    // Both clients join
    ws1.send(encodeMessage({ type: MessageType.JOIN_ROOM, roomId: 'shared-room' }));
    const joined1 = await waitForMessage(ws1, MessageType.ROOM_JOINED) as RoomJoinedMessage;
    expect(joined1.snapshot.bodies).toHaveLength(1);

    ws2.send(encodeMessage({ type: MessageType.JOIN_ROOM, roomId: 'shared-room' }));
    const joined2 = await waitForMessage(ws2, MessageType.ROOM_JOINED) as RoomJoinedMessage;
    expect(joined2.snapshot.bodies).toHaveLength(1);

    // Client 1 sends input
    ws1.send(encodeMessage({
      type: MessageType.CLIENT_INPUT,
      input: {
        tick: 0,
        sequenceNum: 0,
        actions: [
          { type: 'applyImpulse', bodyId: 'shared-box', data: { impulse: { x: 20, y: 0, z: 0 } } },
        ],
      },
    }));

    // Both should receive state updates
    const state1 = await waitForMessage(ws1, MessageType.ROOM_STATE) as RoomStateMessage;
    const state2 = await waitForMessage(ws2, MessageType.ROOM_STATE) as RoomStateMessage;

    expect(state1.bodies.length).toBeGreaterThanOrEqual(1);
    expect(state2.bodies.length).toBeGreaterThanOrEqual(1);

    ws1.close();
    ws2.close();
  });

  it('should handle clock sync requests', async () => {
    server = new PhysicsServer(RAPIER);
    await server.start(TEST_PORT + 3);

    const ws = await connectClient(TEST_PORT + 3);

    const clientTimestamp = Date.now();
    ws.send(encodeMessage({
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp,
    }));

    const response = await waitForMessage(ws, MessageType.CLOCK_SYNC_RESPONSE);
    expect(response.type).toBe(MessageType.CLOCK_SYNC_RESPONSE);
    if (response.type === MessageType.CLOCK_SYNC_RESPONSE) {
      expect(response.clientTimestamp).toBe(clientTimestamp);
      expect(response.serverTimestamp).toBeGreaterThan(0);
    }

    ws.close();
  });

  it('should return error for non-existent room', async () => {
    server = new PhysicsServer(RAPIER);
    await server.start(TEST_PORT + 4);

    const ws = await connectClient(TEST_PORT + 4);

    ws.send(encodeMessage({
      type: MessageType.JOIN_ROOM,
      roomId: 'nonexistent',
    }));

    const errorMsg = await waitForMessage(ws, MessageType.ERROR);
    expect(errorMsg.type).toBe(MessageType.ERROR);

    ws.close();
  });
});
