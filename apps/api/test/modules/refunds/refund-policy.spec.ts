import { describe, expect, it } from 'vitest';

import {
  MONEY_MOVING_REFUND_STATUSES,
  REFUNDABLE_ORDER_STATUSES,
  assertReason,
  assertRefundAmount,
  assertRefundable,
  calculateRefundable,
  isFullyRefunded,
} from '../../../src/modules/refunds/domain/refund-policy';

describe('refund policy', () => {
  it('allows a refund only from a paid, unfinished order', () => {
    for (const status of REFUNDABLE_ORDER_STATUSES) {
      expect(() => assertRefundable(status, 'SUCCEEDED'), status).not.toThrow();
    }

    // Already waiting: entering again is a no-op, not an error.
    expect(() => assertRefundable('REFUND_PENDING', 'SUCCEEDED')).not.toThrow();

    for (const status of ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED']) {
      expect(() => assertRefundable(status, 'SUCCEEDED'), status).toThrow();
    }

    // Unpaid payment: nothing was captured, so nothing can be refunded.
    expect(() => assertRefundable('PAID', 'INITIATED')).toThrow(/paid order/);
    expect(() => assertRefundable('PAID', 'PENDING')).toThrow(/paid order/);
  });

  it('never allows more than was captured', () => {
    const full = calculateRefundable(20_000, 0);
    expect(full).toEqual({ capturedMinor: 20_000, refundedMinor: 0, remainingMinor: 20_000 });

    const partial = calculateRefundable(20_000, 5_000);
    expect(partial.remainingMinor).toBe(15_000);

    // Over-refunded data must not produce a negative ceiling.
    expect(calculateRefundable(20_000, 25_000).remainingMinor).toBe(0);

    expect(() => assertRefundAmount(20_001, 20_000)).toThrow(/exceeds/);
    expect(() => assertRefundAmount(15_001, 15_000)).toThrow(/exceeds/);
    expect(() => assertRefundAmount(0, 20_000)).toThrow(/positive integer/);
    expect(() => assertRefundAmount(100.5, 20_000)).toThrow(/positive integer/);
    expect(() => assertRefundAmount(-1, 20_000)).toThrow(/positive integer/);
    // Exactly the ceiling is allowed.
    expect(() => assertRefundAmount(15_000, 15_000)).not.toThrow();
  });

  it('closes the order only when the whole capture is back', () => {
    expect(isFullyRefunded(20_000, 20_000)).toBe(true);
    expect(isFullyRefunded(20_000, 20_001)).toBe(true);
    expect(isFullyRefunded(20_000, 19_999)).toBe(false);
  });

  it('counts only the money that actually moved', () => {
    // A failed refund did not return anything, so it cannot reduce the ceiling.
    expect(MONEY_MOVING_REFUND_STATUSES).toContain('SUCCEEDED');
    expect(MONEY_MOVING_REFUND_STATUSES).toContain('PROCESSING');
    expect(MONEY_MOVING_REFUND_STATUSES).not.toContain('REQUESTED');
    expect(MONEY_MOVING_REFUND_STATUSES).not.toContain('FAILED');
    expect(MONEY_MOVING_REFUND_STATUSES).not.toContain('REJECTED');
  });

  it('bounds the reason', () => {
    expect(assertReason(undefined)).toBeNull();
    expect(assertReason('   ')).toBeNull();
    expect(assertReason(' 家长要求退款 ')).toBe('家长要求退款');
    expect(() => assertReason('x'.repeat(501))).toThrow(/reason/);
  });
});
