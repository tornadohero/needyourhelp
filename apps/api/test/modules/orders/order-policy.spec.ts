import { describe, expect, it } from 'vitest';

import {
  FEE_VERSION,
  MAX_NOTE_LENGTH,
  MAX_ORDER_WINDOW_DAYS,
  MAX_PAGE_SIZE,
  ORDER_TRANSITIONS,
  PLATFORM_FEE_RATE_BPS,
  assertNote,
  assertPage,
  assertPageSize,
  assertScheduledWindow,
  calculateOrderMoney,
  canTransition,
  generateOrderNo,
  isPaid,
  isTerminal,
} from '../../../src/modules/orders/domain/order-policy';

const NOW = new Date('2026-10-01T00:00:00.000Z');

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

describe('order policy', () => {
  it('moves an order only along the state machine', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    expect(canTransition('PAID', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);

    // "Order cannot become COMPLETED before PAID"
    // (`specs/02-domain-model.md` §State invariants).
    expect(canTransition('PENDING_PAYMENT', 'COMPLETED')).toBe(false);
    expect(canTransition('PAID', 'COMPLETED')).toBe(false);
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
    // A paid order is cancelled through a refund (T016), not by cancelling.
    expect(canTransition('PAID', 'CANCELLED')).toBe(false);

    // Every status is a key of the table: no state is left unhandled.
    expect(Object.keys(ORDER_TRANSITIONS)).toHaveLength(9);
  });

  it('knows the terminal states and what has been paid', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('REFUNDED')).toBe(true);
    expect(isTerminal('DISPUTED')).toBe(true);
    expect(isTerminal('PAID')).toBe(false);

    expect(isPaid('PENDING_PAYMENT')).toBe(false);
    expect(isPaid('CANCELLED')).toBe(false);
    expect(isPaid('PAID')).toBe(true);
    expect(isPaid('COMPLETED')).toBe(true);
  });

  it('calculates total, fee and payout in integer minor units', () => {
    const money = calculateOrderMoney(20_000);

    expect(money).toEqual({
      amountMinor: 20_000,
      platformFeeMinor: 2_000,
      providerAmountMinor: 18_000,
    });

    // Rounded down, never more than the order, never a fraction.
    expect(calculateOrderMoney(1)).toEqual({
      amountMinor: 1,
      platformFeeMinor: 0,
      providerAmountMinor: 1,
    });
    expect(calculateOrderMoney(0)).toEqual({
      amountMinor: 0,
      platformFeeMinor: 0,
      providerAmountMinor: 0,
    });
    expect(calculateOrderMoney(9_999)).toEqual({
      amountMinor: 9_999,
      platformFeeMinor: 999,
      providerAmountMinor: 9_000,
    });

    // Money is never a float (`AGENTS.md` §8).
    expect(() => calculateOrderMoney(100.5)).toThrow(/integer/);
    expect(() => calculateOrderMoney(-1)).toThrow(/integer/);
    expect(PLATFORM_FEE_RATE_BPS).toBe(1_000);
    expect(FEE_VERSION).toBe('platform-fee-v1');
  });

  it('generates a unique, human-facing order number', () => {
    const first = generateOrderNo(NOW);
    const second = generateOrderNo(NOW);

    expect(first).toMatch(/^MO-20261001-[0-9A-F]{8}$/);
    expect(first).not.toBe(second);
  });

  it('accepts only a real, future booking window', () => {
    const window = assertScheduledWindow(at(60), at(120), NOW);
    expect(window.startAt.toISOString()).toBe(at(60).toISOString());

    expect(() => assertScheduledWindow(new Date('nope'), at(120), NOW)).toThrow(/ISO-8601/);
    expect(() => assertScheduledWindow(at(120), at(60), NOW)).toThrow(/end after it starts/);
    expect(() => assertScheduledWindow(at(60), at(60), NOW)).toThrow(/end after it starts/);
    expect(() => assertScheduledWindow(at(-120), at(-60), NOW)).toThrow(/past/);
    expect(() =>
      assertScheduledWindow(
        at(60),
        new Date(NOW.getTime() + (MAX_ORDER_WINDOW_DAYS + 1) * 86_400_000),
        NOW,
      ),
    ).toThrow(/days ahead/);
  });

  it('bounds the note and the paging', () => {
    expect(assertNote(undefined)).toBeNull();
    expect(assertNote('   ')).toBeNull();
    expect(assertNote(' 请准时 ')).toBe('请准时');
    expect(() => assertNote('x'.repeat(MAX_NOTE_LENGTH + 1))).toThrow(/note/);

    expect(assertPage(undefined)).toBe(1);
    expect(assertPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
    for (const invalid of [{ page: 0 }, { pageSize: 0 }, { pageSize: MAX_PAGE_SIZE + 1 }]) {
      const check =
        invalid.page === undefined
          ? () => assertPageSize(invalid.pageSize)
          : () => assertPage(invalid.page);
      expect(check, JSON.stringify(invalid)).toThrow();
    }
  });
});
