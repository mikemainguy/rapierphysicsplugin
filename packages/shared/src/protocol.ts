import type {
  BodyDescriptor,
  BodyState,
  ClientInput,
  RoomSnapshot,
  Vec3,
} from './types.js';

export enum MessageType {
  CLOCK_SYNC_REQUEST = 'clock_sync_request',
  CLOCK_SYNC_RESPONSE = 'clock_sync_response',
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  ROOM_JOINED = 'room_joined',
  ROOM_STATE = 'room_state',
  CLIENT_INPUT = 'client_input',
  BODY_EVENT = 'body_event',
  ADD_BODY = 'add_body',
  REMOVE_BODY = 'remove_body',
  CREATE_ROOM = 'create_room',
  ROOM_CREATED = 'room_created',
  START_SIMULATION = 'start_simulation',
  SIMULATION_STARTED = 'simulation_started',
  ERROR = 'error',
}

// --- Client → Server messages ---

export interface ClockSyncRequestMessage {
  type: MessageType.CLOCK_SYNC_REQUEST;
  clientTimestamp: number;
}

export interface JoinRoomMessage {
  type: MessageType.JOIN_ROOM;
  roomId: string;
}

export interface LeaveRoomMessage {
  type: MessageType.LEAVE_ROOM;
}

export interface ClientInputMessage {
  type: MessageType.CLIENT_INPUT;
  input: ClientInput;
}

export interface AddBodyMessage {
  type: MessageType.ADD_BODY;
  body: BodyDescriptor;
}

export interface RemoveBodyMessage {
  type: MessageType.REMOVE_BODY;
  bodyId: string;
}

export interface CreateRoomMessage {
  type: MessageType.CREATE_ROOM;
  roomId: string;
  initialBodies: BodyDescriptor[];
  gravity?: Vec3;
}

export interface StartSimulationMessage {
  type: MessageType.START_SIMULATION;
}

export interface BodyEventMessage {
  type: MessageType.BODY_EVENT;
  bodyId: string;
  eventType: string;
  data: unknown;
}

// --- Server → Client messages ---

export interface ClockSyncResponseMessage {
  type: MessageType.CLOCK_SYNC_RESPONSE;
  clientTimestamp: number;
  serverTimestamp: number;
}

export interface RoomJoinedMessage {
  type: MessageType.ROOM_JOINED;
  roomId: string;
  snapshot: RoomSnapshot;
  clientId: string;
  simulationRunning: boolean;
}

export interface RoomStateMessage {
  type: MessageType.ROOM_STATE;
  tick: number;
  timestamp: number;
  bodies: BodyState[];
}

export interface RoomCreatedMessage {
  type: MessageType.ROOM_CREATED;
  roomId: string;
}

export interface SimulationStartedMessage {
  type: MessageType.SIMULATION_STARTED;
  snapshot: RoomSnapshot;
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  message: string;
}

export type ClientMessage =
  | ClockSyncRequestMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | ClientInputMessage
  | AddBodyMessage
  | RemoveBodyMessage
  | CreateRoomMessage
  | StartSimulationMessage
  | BodyEventMessage;

export type ServerMessage =
  | ClockSyncResponseMessage
  | RoomJoinedMessage
  | RoomStateMessage
  | RoomCreatedMessage
  | SimulationStartedMessage
  | ErrorMessage
  | AddBodyMessage
  | RemoveBodyMessage
  | BodyEventMessage;
