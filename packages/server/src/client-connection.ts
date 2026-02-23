import type { WebSocket } from 'ws';

export class ClientConnection {
  readonly id: string;
  readonly ws: WebSocket;
  roomId: string | null = null;
  rtt = 0;
  clockOffset = 0;
  lastAcknowledgedTick = 0;
  inputSequence = 0;

  private rttSamples: number[] = [];
  private offsetSamples: number[] = [];
  private static readonly MAX_SAMPLES = 10;

  constructor(id: string, ws: WebSocket) {
    this.id = id;
    this.ws = ws;
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(data);
    }
  }

  updateClockSync(clientTimestamp: number, serverTimestamp: number): void {
    const now = Date.now();
    const rtt = now - clientTimestamp;

    this.rttSamples.push(rtt);
    if (this.rttSamples.length > ClientConnection.MAX_SAMPLES) {
      this.rttSamples.shift();
    }

    const offset = serverTimestamp - clientTimestamp - rtt / 2;
    this.offsetSamples.push(offset);
    if (this.offsetSamples.length > ClientConnection.MAX_SAMPLES) {
      this.offsetSamples.shift();
    }

    // Rolling average
    this.rtt = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
    this.clockOffset = this.offsetSamples.reduce((a, b) => a + b, 0) / this.offsetSamples.length;
  }

  mapClientTickToServerTick(clientTick: number, serverTickRate: number): number {
    // Use clock offset to map client tick to server tick
    const offsetInTicks = Math.round((this.clockOffset / 1000) * serverTickRate);
    return clientTick + offsetInTicks;
  }
}
