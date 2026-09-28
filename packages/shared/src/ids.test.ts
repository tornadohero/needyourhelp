import { describe, expect, it } from 'vitest';

import { assertPublicId, isPublicId, newPublicId } from './ids';

describe('public ids', () => {
  it('generates unique non-sequential identifiers', () => {
    const a = newPublicId();
    const b = newPublicId();
    expect(a).not.toBe(b);
    expect(isPublicId(a)).toBe(true);
  });

  it('rejects sequential database ids and malformed values', () => {
    expect(isPublicId('1')).toBe(false);
    expect(isPublicId(42)).toBe(false);
    expect(isPublicId('')).toBe(false);
    expect(() => assertPublicId('7', 'orderId')).toThrow(/orderId/);
  });
});
