import { describe, expect, it } from 'vitest';

import {
  assertAmountMatches,
  isOpen,
  parseCallbackPayload,
} from '../../../src/modules/payments/domain/payment-policy';

describe('payment policy', () => {
  it('accepts only the exact amount the server calculated', () => {
    expect(() => assertAmountMatches(20_000, 20_000)).not.toThrow();

    // "Amount mismatch => reject callback" (`specs/08` §Payment invariants).
    for (const actual of [1, 19_999, 20_001, 0]) {
      expect(() => assertAmountMatches(20_000, actual), String(actual)).toThrow(/does not match/);
    }
    // A fraction is not an amount at all.
    expect(() => assertAmountMatches(20_000, 20_000.5)).toThrow(/does not match/);
  });

  it('parses a notification and rejects anything malformed', () => {
    const parsed = parseCallbackPayload({
      orderNo: 'MO-20261001-ABCDEF01',
      providerTransactionId: 'txn-1',
      amountMinor: 20_000,
      status: 'SUCCEEDED',
      rawRef: 'stored/callback/1',
    });

    expect(parsed).toEqual({
      orderNo: 'MO-20261001-ABCDEF01',
      providerTransactionId: 'txn-1',
      amountMinor: 20_000,
      status: 'SUCCEEDED',
      rawRef: 'stored/callback/1',
    });

    for (const body of [
      null,
      'text',
      {},
      { orderNo: 'MO-1', providerTransactionId: 'txn-1', amountMinor: 20_000 },
      { orderNo: 'MO-1', providerTransactionId: 'txn-1', amountMinor: 20_000, status: 'PAID' },
      { orderNo: 'MO-1', providerTransactionId: '', amountMinor: 20_000, status: 'SUCCEEDED' },
      {
        orderNo: 'MO-1',
        providerTransactionId: 'txn-1',
        amountMinor: '20000',
        status: 'SUCCEEDED',
      },
    ]) {
      expect(() => parseCallbackPayload(body), JSON.stringify(body)).toThrow();
    }
  });

  it('knows which attempts are still open', () => {
    expect(isOpen('INITIATED')).toBe(true);
    expect(isOpen('PENDING')).toBe(true);
    expect(isOpen('SUCCEEDED')).toBe(false);
    expect(isOpen('FAILED')).toBe(false);
    expect(isOpen('CLOSED')).toBe(false);
  });
});
