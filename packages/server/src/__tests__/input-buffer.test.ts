import { describe, it, expect, beforeEach } from 'vitest';
import { InputBuffer } from '../input-buffer.js';
import type { ClientInput } from '@havokserver/shared';

describe('InputBuffer', () => {
  let buffer: InputBuffer;

  beforeEach(() => {
    buffer = new InputBuffer();
  });

  function makeInput(tick: number, seq: number): ClientInput {
    return {
      tick,
      sequenceNum: seq,
      actions: [{ type: 'applyForce', bodyId: 'body1', data: { force: { x: 1, y: 0, z: 0 } } }],
    };
  }

  it('should store and retrieve inputs for a tick', () => {
    buffer.addInput(makeInput(10, 0), 10);
    const inputs = buffer.getInputsForTick(10);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].sequenceNum).toBe(0);
  });

  it('should return empty array for tick with no inputs', () => {
    const inputs = buffer.getInputsForTick(999);
    expect(inputs).toHaveLength(0);
  });

  it('should remove inputs after retrieval', () => {
    buffer.addInput(makeInput(10, 0), 10);
    buffer.getInputsForTick(10);
    const inputs = buffer.getInputsForTick(10);
    expect(inputs).toHaveLength(0);
  });

  it('should accumulate multiple inputs for the same tick', () => {
    buffer.addInput(makeInput(10, 0), 10);
    buffer.addInput(makeInput(10, 1), 10);
    buffer.addInput(makeInput(10, 2), 10);

    const inputs = buffer.getInputsForTick(10);
    expect(inputs).toHaveLength(3);
  });

  it('should handle inputs for different ticks', () => {
    buffer.addInput(makeInput(10, 0), 10);
    buffer.addInput(makeInput(11, 1), 11);
    buffer.addInput(makeInput(12, 2), 12);

    expect(buffer.getInputsForTick(10)).toHaveLength(1);
    expect(buffer.getInputsForTick(11)).toHaveLength(1);
    expect(buffer.getInputsForTick(12)).toHaveLength(1);
  });

  it('should clear all inputs', () => {
    buffer.addInput(makeInput(10, 0), 10);
    buffer.addInput(makeInput(11, 1), 11);
    buffer.clear();
    expect(buffer.size).toBe(0);
  });
});
