import type { ClockSyncRequestMessage, ClockSyncResponseMessage } from '@havokserver/shared';
import { MessageType, encodeMessage } from '@havokserver/shared';
import type { ClientConnection } from './client-connection.js';

export function handleClockSyncRequest(
  conn: ClientConnection,
  message: ClockSyncRequestMessage
): void {
  const response: ClockSyncResponseMessage = {
    type: MessageType.CLOCK_SYNC_RESPONSE,
    clientTimestamp: message.clientTimestamp,
    serverTimestamp: Date.now(),
  };

  conn.send(encodeMessage(response));
}
