import { describe, it, expect, beforeEach } from 'vitest';
import { ClockSyncClient } from '../clock-sync.js';
import { MessageType } from '@havokserver/shared';

describe('ClockSyncClient', () => {
  let clockSync: ClockSyncClient;

  beforeEach(() => {
    clockSync = new ClockSyncClient();
  });

  it('should start uncalibrated', () => {
    expect(clockSync.isCalibrated).toBe(false);
    expect(clockSync.getRTT()).toBe(0);
    expect(clockSync.getClockOffset()).toBe(0);
  });

  it('should calculate RTT from response', () => {
    const clientTimestamp = Date.now() - 50; // Simulate 50ms ago
    clockSync.handleResponse({
      type: MessageType.CLOCK_SYNC_RESPONSE,
      clientTimestamp,
      serverTimestamp: clientTimestamp + 25, // Server received ~25ms after client sent
    });

    const rtt = clockSync.getRTT();
    expect(rtt).toBeGreaterThan(0);
    expect(rtt).toBeLessThan(200); // Reasonable RTT
  });

  it('should become calibrated after 3 samples', () => {
    for (let i = 0; i < 3; i++) {
      const clientTimestamp = Date.now() - 50;
      clockSync.handleResponse({
        type: MessageType.CLOCK_SYNC_RESPONSE,
        clientTimestamp,
        serverTimestamp: clientTimestamp + 25,
      });
    }
    expect(clockSync.isCalibrated).toBe(true);
  });

  it('should compute rolling average RTT', () => {
    // Send several responses with known RTTs
    for (let i = 0; i < 5; i++) {
      const clientTimestamp = Date.now() - 100;
      clockSync.handleResponse({
        type: MessageType.CLOCK_SYNC_RESPONSE,
        clientTimestamp,
        serverTimestamp: clientTimestamp + 50,
      });
    }

    const rtt = clockSync.getRTT();
    // RTT should be around 100ms (now - clientTimestamp)
    expect(rtt).toBeGreaterThan(50);
    expect(rtt).toBeLessThan(300);
  });

  it('should get server time estimate', () => {
    const now = Date.now();
    clockSync.handleResponse({
      type: MessageType.CLOCK_SYNC_RESPONSE,
      clientTimestamp: now - 50,
      serverTimestamp: now - 25,
    });

    const serverTime = clockSync.getServerTime();
    // Server time should be close to current time
    expect(Math.abs(serverTime - Date.now())).toBeLessThan(200);
  });
});
