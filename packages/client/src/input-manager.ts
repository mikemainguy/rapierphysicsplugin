import type { ClientInput, InputAction } from '@havokserver/shared';
import { MAX_INPUT_BUFFER, CLIENT_INPUT_RATE } from '@havokserver/shared';

export class InputManager {
  private pendingActions: InputAction[] = [];
  private inputHistory: ClientInput[] = [];
  private sequenceNum = 0;
  private currentTick = 0;
  private sendFn: ((input: ClientInput) => void) | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(sendFn: (input: ClientInput) => void, getTickFn: () => number): void {
    this.sendFn = sendFn;

    const intervalMs = 1000 / CLIENT_INPUT_RATE;
    this.intervalId = setInterval(() => {
      this.currentTick = getTickFn();
      this.flush();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.sendFn = null;
  }

  queueAction(action: InputAction): void {
    this.pendingActions.push(action);
  }

  flush(): void {
    if (this.pendingActions.length === 0) return;
    if (!this.sendFn) return;

    const input: ClientInput = {
      tick: this.currentTick,
      sequenceNum: this.sequenceNum++,
      actions: [...this.pendingActions],
    };

    this.pendingActions = [];

    // Store in history for reconciliation
    this.inputHistory.push(input);
    if (this.inputHistory.length > MAX_INPUT_BUFFER) {
      this.inputHistory.shift();
    }

    this.sendFn(input);
  }

  getInputHistory(): ClientInput[] {
    return this.inputHistory;
  }

  getInputsSince(tick: number): ClientInput[] {
    return this.inputHistory.filter(input => input.tick > tick);
  }

  clearHistory(): void {
    this.inputHistory = [];
  }

  clear(): void {
    this.pendingActions = [];
    this.inputHistory = [];
    this.sequenceNum = 0;
  }
}
