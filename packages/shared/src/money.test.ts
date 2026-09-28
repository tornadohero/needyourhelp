import { describe, expect, it } from 'vitest';

import { allocateMinor, applyRateBp, formatMinor, fromMinor, MoneyError, toMinor } from './money';

describe('money', () => {
  it('converts major units to integer minor units', () => {
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(0.01)).toBe(1);
    expect(toMinor(99.99)).toBe(9999);
  });

  it('never produces fractional minor units', () => {
    const minor = toMinor(19.999);
    expect(Number.isInteger(minor)).toBe(true);
    expect(minor).toBe(2000);
  });

  it('rejects non-finite amounts', () => {
    expect(() => toMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('formats for display only', () => {
    expect(formatMinor(toMinor(100))).toBe('100.00');
    expect(formatMinor(toMinor(100), '¥')).toBe('¥ 100.00');
    expect(fromMinor(toMinor(8.5))).toBe(8.5);
  });

  it('applies basis-point rates with integer rounding', () => {
    expect(applyRateBp(toMinor(100), 1000)).toBe(1000);
    expect(applyRateBp(toMinor(33.33), 333)).toBe(111);
    expect(() => applyRateBp(toMinor(10), -1)).toThrow(MoneyError);
  });

  it('allocates without losing a single minor unit', () => {
    const parts = allocateMinor(toMinor(10), 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((sum, p) => sum + p, 0)).toBe(1000);
    expect(() => allocateMinor(toMinor(1), 0)).toThrow(MoneyError);
  });
});
