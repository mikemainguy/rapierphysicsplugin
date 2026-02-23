import type { ClientInput } from '@havokserver/shared';
import { MAX_INPUT_BUFFER } from '@havokserver/shared';

export class InputBuffer {
  private buffer: Map<number, ClientInput[]> = new Map();
  private oldestTick = 0;

  addInput(input: ClientInput, serverTick: number): void {
    // Map client tick to server tick using provided mapping
    const targetTick = serverTick;

    if (!this.buffer.has(targetTick)) {
      this.buffer.set(targetTick, []);
    }
    this.buffer.get(targetTick)!.push(input);

    // Clean up old entries
    this.pruneOldEntries(targetTick);
  }

  getInputsForTick(tick: number): ClientInput[] {
    const inputs = this.buffer.get(tick);
    if (inputs) {
      this.buffer.delete(tick);
      return inputs;
    }
    return [];
  }

  private pruneOldEntries(currentTick: number): void {
    const cutoff = currentTick - MAX_INPUT_BUFFER;
    for (const tick of this.buffer.keys()) {
      if (tick < cutoff) {
        this.buffer.delete(tick);
      }
    }
  }

  clear(): void {
    this.buffer.clear();
  }

  get size(): number {
    return this.buffer.size;
  }
}
