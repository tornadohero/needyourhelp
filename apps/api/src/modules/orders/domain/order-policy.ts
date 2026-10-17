import { randomUUID } from 'node:crypto';

import { orderInvalidRequest } from './order.errors';
import type { OrderMoney, OrderStatus } from './order.model';

/**
 * Order rules: the state machine and the money.
 *
 * `specs/06-verification-state-machine.md` §Order and the acceptance criterion
 * of T013 ("no direct status PATCH", "server calculates total") both live here.
 */

/**
 * The state machine.
 *
 * Explicit commands only: `PAID` is written by the payment context (T014),
 * `REFUND_PENDING`/`REFUNDED` by refunds (T016) and `DISPUTED` by moderation
 * (T018). Nothing else may set a status, and no route patches one.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['CONFIRMED', 'REFUND_PENDING', 'DISPUTED'],
  CONFIRMED: ['IN_PROGRESS', 'REFUND_PENDING', 'DISPUTED'],
  IN_PROGRESS: ['COMPLETED', 'REFUND_PENDING', 'DISPUTED'],
  COMPLETED: [],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
  DISPUTED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** A terminal order never moves again: only refunds/disputes branch earlier. */
export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Paid or later: the money is in the platform's hands. */
export function isPaid(status: OrderStatus): boolean {
  return status !== 'PENDING_PAYMENT' && status !== 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Platform fee configuration.
 *
 * `specs/03-architecture-spec.md` §Environments and
 * `specs/12-admin-spec.md` §Platform configuration put fees behind published
 * platform rules (T019); until a rule is published these defaults apply, and
 * every order records the version it used so a later rule change cannot
 * rewrite history (`AGENTS.md` §8).
 */
export const FEE_VERSION = 'platform-fee-v1';

/** Basis points: 1000 = 10.00%. */
export const PLATFORM_FEE_RATE_BPS = 1_000;

/**
 * The server's arithmetic: price -> total, fee and provider payout.
 *
 * Integer minor units only (`AGENTS.md` §8), rounded down so the platform never
 * takes more than the configured rate.
 */
export function calculateOrderMoney(
  priceMinor: number,
  feeRateBps: number = PLATFORM_FEE_RATE_BPS,
): OrderMoney {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) {
    throw orderInvalidRequest('A service price must be a non-negative integer of minor units.');
  }

  const platformFeeMinor = Math.min(priceMinor, Math.floor((priceMinor * feeRateBps) / 10_000));

  return {
    amountMinor: priceMinor,
    platformFeeMinor,
    providerAmountMinor: priceMinor - platformFeeMinor,
  };
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

/** Human-facing reference, stable and unique (`orders.order_no`). */
export function generateOrderNo(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `MO-${day}-${suffix}`;
}

export const MAX_NOTE_LENGTH = 500;

/** A booking window has to be real, ordered and in the future. */
export const MAX_ORDER_WINDOW_DAYS = 365;

export function assertScheduledWindow(
  startAt: Date,
  endAt: Date,
  now: Date = new Date(),
): { startAt: Date; endAt: Date } {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw orderInvalidRequest('An order needs a valid ISO-8601 scheduled start and end.');
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw orderInvalidRequest('An order must end after it starts.');
  }
  if (startAt.getTime() < now.getTime()) {
    throw orderInvalidRequest('An order cannot be scheduled in the past.');
  }
  const horizon = now.getTime() + MAX_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (endAt.getTime() > horizon) {
    throw orderInvalidRequest(
      `An order cannot be scheduled more than ${MAX_ORDER_WINDOW_DAYS} days ahead.`,
    );
  }
  return { startAt, endAt };
}

export function assertNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const note = value.trim();
  if (note.length === 0) {
    return null;
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw orderInvalidRequest(`A note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  return note;
}

/** A listing is always bounded (`specs/05-api-spec.md` defines no paging). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export function assertPage(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw orderInvalidRequest('page must be a positive integer.');
  }
  return value;
}

export function assertPageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw orderInvalidRequest(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}
