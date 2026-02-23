import { pack, unpack } from 'msgpackr';
import type { ClientMessage, ServerMessage, RoomStateMessage } from './protocol.js';
import { MessageType } from './protocol.js';
import { encodeRoomState, decodeRoomState } from './binary-state-codec.js';

const OPCODE_ROOM_STATE = 0x01;
const OPCODE_MSGPACK = 0x02;

export function encodeMessage(message: ClientMessage | ServerMessage): Uint8Array {
  if ('type' in message && message.type === MessageType.ROOM_STATE) {
    return encodeRoomState(message as RoomStateMessage);
  }
  const packed = pack(message);
  const result = new Uint8Array(1 + packed.length);
  result[0] = OPCODE_MSGPACK;
  result.set(packed, 1);
  return result;
}

export function decodeMessage(data: Uint8Array): ClientMessage | ServerMessage {
  if (data[0] === OPCODE_ROOM_STATE) {
    return decodeRoomState(data);
  }
  return unpack(data.subarray(1)) as ClientMessage | ServerMessage;
}

export function decodeClientMessage(data: Uint8Array): ClientMessage {
  return decodeMessage(data) as ClientMessage;
}

export function decodeServerMessage(data: Uint8Array): ServerMessage {
  return decodeMessage(data) as ServerMessage;
}
