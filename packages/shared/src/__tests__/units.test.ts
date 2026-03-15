import { describe, it, expect } from 'vitest';
import { mphToMs, kmhToMs, msToMph, msToKmh, rpmToRadS, radSToRpm } from '../units.js';

describe('unit conversions', () => {
  describe('linear velocity', () => {
    it('converts mph to m/s', () => {
      expect(mphToMs(60)).toBeCloseTo(26.8224, 4);
      expect(mphToMs(0)).toBe(0);
      expect(mphToMs(100)).toBeCloseTo(44.704, 3);
    });

    it('converts km/h to m/s', () => {
      expect(kmhToMs(3.6)).toBeCloseTo(1, 10);
      expect(kmhToMs(100)).toBeCloseTo(27.7778, 3);
      expect(kmhToMs(0)).toBe(0);
    });

    it('converts m/s to mph', () => {
      expect(msToMph(mphToMs(60))).toBeCloseTo(60, 10);
      expect(msToMph(1)).toBeCloseTo(2.23694, 4);
    });

    it('converts m/s to km/h', () => {
      expect(msToKmh(kmhToMs(100))).toBeCloseTo(100, 10);
      expect(msToKmh(1)).toBeCloseTo(3.6, 10);
    });
  });

  describe('angular velocity', () => {
    it('converts RPM to rad/s', () => {
      expect(rpmToRadS(60)).toBeCloseTo(2 * Math.PI, 10);
      expect(rpmToRadS(0)).toBe(0);
      expect(rpmToRadS(1)).toBeCloseTo(Math.PI / 30, 10);
    });

    it('converts rad/s to RPM', () => {
      expect(radSToRpm(rpmToRadS(120))).toBeCloseTo(120, 10);
      expect(radSToRpm(2 * Math.PI)).toBeCloseTo(60, 10);
    });
  });
});
