import { WebSocketServer, WebSocket } from 'ws';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  MessageType,
  decodeClientMessage,
  encodeMessage,
  DEFAULT_PORT,
} from '@rapierphysicsplugin/shared';
import type { ClientMessage } from '@rapierphysicsplugin/shared';
import { RoomManager } from './room.js';
import { ClientConnection } from './client-connection.js';
import { handleClockSyncRequest } from './clock-sync.js';

let clientIdCounter = 0;
function generateClientId(): string {
  return `client_${++clientIdCounter}`;
}

export class PhysicsServer {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, ClientConnection> = new Map();
  private roomManager: RoomManager;
  private rapier: typeof RAPIER;

  constructor(rapier: typeof RAPIER) {
    this.rapier = rapier;
    this.roomManager = new RoomManager(rapier);
  }

  start(port: number = DEFAULT_PORT): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port });

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });

      this.wss.on('listening', () => {
        console.log(`Physics server listening on port ${port}`);
        resolve();
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    const clientId = generateClientId();
    const conn = new ClientConnection(clientId, ws);
    this.connections.set(clientId, conn);

    console.log(`Client connected: ${clientId}`);

    ws.on('message', (data: Buffer) => {
      try {
        const message = decodeClientMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        this.handleMessage(conn, message);
      } catch (err) {
        console.error(`Error processing message from ${clientId}:`, err);
        conn.send(encodeMessage({
          type: MessageType.ERROR,
          message: 'Invalid message format',
        }));
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(conn);
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${clientId}:`, err);
    });
  }

  private handleMessage(conn: ClientConnection, message: ClientMessage): void {
    switch (message.type) {
      case MessageType.CLOCK_SYNC_REQUEST:
        handleClockSyncRequest(conn, message);
        break;

      case MessageType.CREATE_ROOM: {
        try {
          const room = this.roomManager.createRoom(
            message.roomId,
            message.initialBodies,
            message.gravity
          );
          conn.send(encodeMessage({
            type: MessageType.ROOM_CREATED,
            roomId: room.id,
          }));
        } catch (err) {
          conn.send(encodeMessage({
            type: MessageType.ERROR,
            message: (err as Error).message,
          }));
        }
        break;
      }

      case MessageType.JOIN_ROOM: {
        const room = this.roomManager.getRoom(message.roomId);
        if (!room) {
          conn.send(encodeMessage({
            type: MessageType.ERROR,
            message: `Room "${message.roomId}" not found`,
          }));
          return;
        }

        // Leave current room if in one
        if (conn.roomId) {
          const currentRoom = this.roomManager.getRoom(conn.roomId);
          currentRoom?.removeClient(conn);
        }

        room.addClient(conn);
        break;
      }

      case MessageType.LEAVE_ROOM: {
        if (conn.roomId) {
          const room = this.roomManager.getRoom(conn.roomId);
          room?.removeClient(conn);
        }
        break;
      }

      case MessageType.CLIENT_INPUT: {
        if (!conn.roomId) return;
        const room = this.roomManager.getRoom(conn.roomId);
        if (room) {
          room.bufferInput(conn.id, message.input);
        }
        break;
      }

      case MessageType.ADD_BODY: {
        if (!conn.roomId) return;
        const room = this.roomManager.getRoom(conn.roomId);
        if (room) {
          try {
            room.addBody(message.body);
          } catch (err) {
            conn.send(encodeMessage({
              type: MessageType.ERROR,
              message: (err as Error).message,
            }));
          }
        }
        break;
      }

      case MessageType.REMOVE_BODY: {
        if (!conn.roomId) return;
        const room = this.roomManager.getRoom(conn.roomId);
        if (room) {
          room.removeBody(message.bodyId);
        }
        break;
      }

      case MessageType.START_SIMULATION: {
        if (!conn.roomId) return;
        const room = this.roomManager.getRoom(conn.roomId);
        if (room) {
          room.startSimulation();
        }
        break;
      }

      case MessageType.BODY_EVENT: {
        if (!conn.roomId) return;
        // Rebroadcast body events to all clients in the room
        const room = this.roomManager.getRoom(conn.roomId);
        if (room) {
          // The room broadcast is handled by forwarding the message
          // For now, we just log it
          console.log(`Body event from ${conn.id}: ${message.eventType} on ${message.bodyId}`);
        }
        break;
      }
    }
  }

  private handleDisconnect(conn: ClientConnection): void {
    console.log(`Client disconnected: ${conn.id}`);

    if (conn.roomId) {
      const room = this.roomManager.getRoom(conn.roomId);
      room?.removeClient(conn);
    }

    this.connections.delete(conn.id);
  }

  stop(): void {
    // Destroy all rooms
    for (const roomId of this.roomManager.getAllRoomIds()) {
      this.roomManager.destroyRoom(roomId);
    }

    // Close all connections
    for (const [, conn] of this.connections) {
      conn.ws.close();
    }
    this.connections.clear();

    // Close server
    this.wss?.close();
    this.wss = null;
  }

  getRoomManager(): RoomManager {
    return this.roomManager;
  }
}
