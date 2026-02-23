import type { ClientMessage, ServerMessage } from './protocol.js';

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(data: string): ClientMessage | ServerMessage {
  return JSON.parse(data) as ClientMessage | ServerMessage;
}

export function decodeClientMessage(data: string): ClientMessage {
  return JSON.parse(data) as ClientMessage;
}

export function decodeServerMessage(data: string): ServerMessage {
  return JSON.parse(data) as ServerMessage;
}
