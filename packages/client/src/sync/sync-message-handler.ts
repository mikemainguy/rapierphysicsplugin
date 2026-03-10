import type {
  ServerMessage,
  RoomSnapshot,
  BodyDescriptor,
  ConstraintDescriptor,
  ClientMessage,
  MeshBinaryMessage,
} from '@rapierphysicsplugin/shared';
import {
  MessageType,
  decodeServerMessage,
  OPCODE_MESH_BINARY,
  decodeMeshBinary,
  OPCODE_GEOMETRY_DEF,
  OPCODE_MESH_REF,
  OPCODE_MATERIAL_DEF,
  OPCODE_TEXTURE_DEF,
  decodeGeometryDef,
  decodeMeshRef,
  decodeMaterialDef,
  decodeTextureDef,
} from '@rapierphysicsplugin/shared';
import type { ClockSyncClient } from './clock-sync.js';
import type { StateReconciler } from './state-reconciler.js';
import type { InputManager } from './input-manager.js';
import type { BodyStateTracker } from './sync-body-state.js';
import type { QueryManager } from './sync-queries.js';
import type { SyncCallbacks } from './sync-callbacks.js';

export interface SyncClientMutableState {
  simulationRunning: boolean;
  roomId: string | null;
  clientId: string | null;
  createResolve: (() => void) | null;
  joinResolve: ((snapshot: RoomSnapshot) => void) | null;
}

export interface MessageHandlerContext {
  state: SyncClientMutableState;
  bodyState: BodyStateTracker;
  clockSync: ClockSyncClient;
  reconciler: StateReconciler;
  inputManager: InputManager;
  callbacks: SyncCallbacks;
  queries: QueryManager;
  send: (msg: ClientMessage) => void;
}

export function dispatchBinaryMessage(buf: Uint8Array, ctx: MessageHandlerContext): void {
  if (buf[0] === OPCODE_MESH_BINARY) {
    const decoded = decodeMeshBinary(buf);
    const msg: MeshBinaryMessage = { type: MessageType.MESH_BINARY, ...decoded };
    for (const cb of ctx.callbacks.meshBinary) cb(msg);
    return;
  }

  if (buf[0] === OPCODE_GEOMETRY_DEF) {
    const decoded = decodeGeometryDef(buf);
    for (const cb of ctx.callbacks.geometryDef) cb(decoded);
    return;
  }

  if (buf[0] === OPCODE_MESH_REF) {
    const decoded = decodeMeshRef(buf);
    for (const cb of ctx.callbacks.meshRef) cb(decoded);
    return;
  }

  if (buf[0] === OPCODE_MATERIAL_DEF) {
    const decoded = decodeMaterialDef(buf);
    for (const cb of ctx.callbacks.materialDef) cb(decoded);
    return;
  }

  if (buf[0] === OPCODE_TEXTURE_DEF) {
    const decoded = decodeTextureDef(buf);
    for (const cb of ctx.callbacks.textureDef) cb(decoded);
    return;
  }

  const message = decodeServerMessage(buf, ctx.bodyState.indexToId);
  handleServerMessage(message, ctx);
}

function handleServerMessage(message: ServerMessage, ctx: MessageHandlerContext): void {
  const { state, bodyState, clockSync, reconciler, inputManager, callbacks, queries } = ctx;

  switch (message.type) {
    case MessageType.CLOCK_SYNC_RESPONSE:
      clockSync.handleResponse(message);
      break;

    case MessageType.ROOM_CREATED:
      state.createResolve?.();
      state.createResolve = null;
      break;

    case MessageType.ROOM_JOINED:
      state.roomId = message.roomId;
      state.clientId = message.clientId;
      state.simulationRunning = message.simulationRunning;

      if (message.bodyIdMap) {
        bodyState.initBodyIdMap(message.bodyIdMap);
      }

      bodyState.initFullState(message.snapshot.bodies);
      reconciler.processServerState(message.snapshot);

      inputManager.start(
        (input) => {
          reconciler.addPendingInput(input);
          ctx.send({ type: MessageType.CLIENT_INPUT, input });
        },
        () => clockSync.getServerTick(),
      );

      if (message.constraints) {
        for (const c of message.constraints) {
          for (const cb of callbacks.constraintAdded) cb(c);
        }
      }

      if (message.bodies) {
        for (const b of message.bodies) {
          if (message.bodyIdMap && message.bodyIdMap[b.id] !== undefined) {
            bodyState.addBodyIdMapping(b.id, message.bodyIdMap[b.id]);
          }
          for (const cb of callbacks.bodyAdded) cb(b);
        }
      }

      state.joinResolve?.(message.snapshot);
      state.joinResolve = null;
      break;

    case MessageType.ROOM_STATE: {
      const mergedBodies = bodyState.mergeDelta(message.bodies);
      const snapshot: RoomSnapshot = {
        tick: message.tick,
        timestamp: message.timestamp,
        bodies: mergedBodies,
      };
      reconciler.processServerState(snapshot);
      for (const cb of callbacks.stateUpdate) cb(snapshot);
      break;
    }

    case MessageType.ADD_BODY:
      if (message.bodyIndex !== undefined) {
        bodyState.addBodyIdMapping(message.body.id, message.bodyIndex);
      }
      for (const cb of callbacks.bodyAdded) cb(message.body);
      break;

    case MessageType.REMOVE_BODY:
      bodyState.removeBody(message.bodyId);
      for (const cb of callbacks.bodyRemoved) cb(message.bodyId);
      break;

    case MessageType.SIMULATION_STARTED: {
      state.simulationRunning = true;
      reconciler.clear();

      const simMsg = message as ServerMessage & { bodyIdMap?: Record<string, number> };
      if (simMsg.bodyIdMap) {
        bodyState.initBodyIdMap(simMsg.bodyIdMap);
      }

      bodyState.initFullState(message.snapshot.bodies);

      const simConstraints = (message as ServerMessage & { constraints?: ConstraintDescriptor[] }).constraints;
      if (simConstraints) {
        for (const c of simConstraints) {
          for (const cb of callbacks.constraintAdded) cb(c);
        }
      }

      const simBodies = (message as ServerMessage & { bodies?: BodyDescriptor[] }).bodies;
      if (simBodies) {
        for (const b of simBodies) {
          for (const cb of callbacks.bodyAdded) cb(b);
        }
      }

      for (const cb of callbacks.simulationStarted) cb(message.snapshot);
      break;
    }

    case MessageType.COLLISION_EVENTS:
      for (const cb of callbacks.collisionEvents) cb(message.events);
      break;

    case MessageType.ADD_CONSTRAINT:
      for (const cb of callbacks.constraintAdded) cb(message.constraint);
      break;

    case MessageType.REMOVE_CONSTRAINT:
      for (const cb of callbacks.constraintRemoved) cb(message.constraintId);
      break;

    case MessageType.UPDATE_CONSTRAINT:
      for (const cb of callbacks.constraintUpdated) cb(message.constraintId, message.updates);
      break;

    case MessageType.SHAPE_CAST_RESPONSE:
      queries.resolveQuery(message.response.queryId, message.response);
      break;

    case MessageType.SHAPE_PROXIMITY_RESPONSE:
      queries.resolveQuery(message.response.queryId, message.response);
      break;

    case MessageType.POINT_PROXIMITY_RESPONSE:
      queries.resolveQuery(message.response.queryId, message.response);
      break;

    case MessageType.ERROR:
      console.error(`Server error: ${message.message}`);
      break;
  }
}
