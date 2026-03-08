import {
  MessageType,
  CLOCK_SYNC_INTERVAL_MS,
  CLOCK_SYNC_SAMPLES,
  SERVER_TICK_RATE,
  FIXED_TIMESTEP,
  encodeMessage,
} from '@rapierphysicsplugin/shared';
import type { ClockSyncResponseMessage } from '@rapierphysicsplugin/shared';

export class ClockSyncClient {
  private rttSamples: number[] = [];
  private offsetSamples: number[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sendFn: ((data: Uint8Array) => void) | null = null;
  private syncIntervalMs: number;
  private maxSamples: number;

  constructor(syncIntervalMs?: number, maxSamples?: number) {
    this.syncIntervalMs = syncIntervalMs ?? CLOCK_SYNC_INTERVAL_MS;
    this.maxSamples = maxSamples ?? CLOCK_SYNC_SAMPLES;
  }

  start(sendFn: (data: Uint8Array) => void): void {
    this.sendFn = sendFn;
    this.sendSyncRequest();
    this.intervalId = setInterval(() => this.sendSyncRequest(), this.syncIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.sendFn = null;
  }

  private sendSyncRequest(): void {
    if (!this.sendFn) return;
    this.sendFn(encodeMessage({
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp: Date.now(),
    }));
  }

  handleResponse(message: ClockSyncResponseMessage): void {
    const now = Date.now();
    const rtt = now - message.clientTimestamp;
    const offset = message.serverTimestamp - message.clientTimestamp - rtt / 2;

    this.rttSamples.push(rtt);
    if (this.rttSamples.length > this.maxSamples) {
      this.rttSamples.shift();
    }

    this.offsetSamples.push(offset);
    if (this.offsetSamples.length > this.maxSamples) {
      this.offsetSamples.shift();
    }
  }

  getRTT(): number {
    if (this.rttSamples.length === 0) return 0;
    return this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
  }

  getClockOffset(): number {
    if (this.offsetSamples.length === 0) return 0;
    return this.offsetSamples.reduce((a, b) => a + b, 0) / this.offsetSamples.length;
  }

  getServerTime(): number {
    return Date.now() + this.getClockOffset();
  }

  getServerTick(): number {
    const serverTimeMs = this.getServerTime();
    return Math.floor(serverTimeMs / (FIXED_TIMESTEP * 1000));
  }

  get isCalibrated(): boolean {
    return this.rttSamples.length >= 3;
  }
}
