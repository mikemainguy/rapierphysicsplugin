import { FIXED_TIMESTEP, BROADCAST_INTERVAL } from '@rapierphysicsplugin/shared';
import type { Room } from './room.js';

export class SimulationLoop {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private accumulator = 0;

  constructor(private room: Room) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    // Use setInterval at ~1ms for high resolution stepping
    this.timer = setInterval(() => this.update(), 1);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private update(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = now;

    // Cap elapsed time to prevent spiral of death
    const cappedElapsed = Math.min(elapsed, FIXED_TIMESTEP * 10);
    this.accumulator += cappedElapsed;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.room.tick();
      this.accumulator -= FIXED_TIMESTEP;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
