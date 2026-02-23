import {
  MessageType,
  CLOCK_SYNC_INTERVAL_MS,
  CLOCK_SYNC_SAMPLES,
  SERVER_TICK_RATE,
  FIXED_TIMESTEP,
} from '@havokserver/shared';
import type { ClockSyncResponseMessage } from '@havokserver/shared';

export class ClockSyncClient {
  private rttSamples: number[] = [];
  private offsetSamples: number[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sendFn: ((data: string) => void) | null = null;

  start(sendFn: (data: string) => void): void {
    this.sendFn = sendFn;
    this.sendSyncRequest();
    this.intervalId = setInterval(() => this.sendSyncRequest(), CLOCK_SYNC_INTERVAL_MS);
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
    this.sendFn(JSON.stringify({
      type: MessageType.CLOCK_SYNC_REQUEST,
      clientTimestamp: Date.now(),
    }));
  }

  handleResponse(message: ClockSyncResponseMessage): void {
    const now = Date.now();
    const rtt = now - message.clientTimestamp;
    const offset = message.serverTimestamp - message.clientTimestamp - rtt / 2;

    this.rttSamples.push(rtt);
    if (this.rttSamples.length > CLOCK_SYNC_SAMPLES) {
      this.rttSamples.shift();
    }

    this.offsetSamples.push(offset);
    if (this.offsetSamples.length > CLOCK_SYNC_SAMPLES) {
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
