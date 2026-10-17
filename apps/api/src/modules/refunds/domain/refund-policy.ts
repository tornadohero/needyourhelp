import type { RefundableAmount, RefundStatus } from './refund.model';
import { refundInvalidRequest, refundNotAllowed } from './refund.errors';

/**
 * The refund policy engine (`specs/08-payment-and-settlement.md` §Refund:
 * "validate order state/policy; calculate refundable amount server-side").
 *
 * The engine answers three questions and owns nothing else: may this order be
 * refunded, how much is still refundable, and is this amount allowed.
 */

/**
 * Order states that may *enter* a refund.
 *
 * `specs/06` §Order draws `PAID -> REFUND_PENDING -> REFUNDED`; the order
 * transitions of T013 also allow a refund from `CONFIRMED` and `IN_PROGRESS`,
 * because a paid session that has not completed can still be refunded. A
 * `COMPLETED`, `CANCELLED`, `DISPUTED` or `REFUNDED` order cannot.
 */
export const REFUNDABLE_ORDER_STATUSES: readonly string[] = ['PAID', 'CONFIRMED', 'IN_PROGRESS'];

/** An order already waiting for a refund stays refundable (idempotent entry). */
export const REFUND_PENDING_STATUS = 'REFUND_PENDING';

/** Only a captured payment can be refunded. */
export const REFUNDABLE_PAYMENT_STATUS = 'SUCCEEDED';

/** Refund statuses that have taken (or may be taking) money. */
export const MONEY_MOVING_REFUND_STATUSES: readonly RefundStatus[] = ['SUCCEEDED', 'PROCESSING'];

export const MAX_REFUND_REASON_LENGTH = 500;

/** An order can only be refunded once the money is in and the state allows it. */
export function assertRefundable(orderStatus: string, paymentStatus: string): void {
  if (paymentStatus !== REFUNDABLE_PAYMENT_STATUS) {
    throw refundNotAllowed('Only a paid order can be refunded.');
  }
  if (orderStatus === REFUND_PENDING_STATUS) {
    // Already waiting for a refund: entering again changes nothing.
    return;
  }
  if (!REFUNDABLE_ORDER_STATUSES.includes(orderStatus)) {
    throw refundNotAllowed(`An order in status ${orderStatus} cannot be refunded.`);
  }
}

/**
 * What is still refundable: captured minus what already moved back.
 *
 * Never negative, never more than captured ("cannot refund more than captured").
 */
export function calculateRefundable(
  capturedMinor: number,
  alreadyRefundedMinor: number,
): RefundableAmount {
  const refundedMinor = Math.max(0, alreadyRefundedMinor);
  return {
    capturedMinor,
    refundedMinor,
    remainingMinor: Math.max(0, capturedMinor - refundedMinor),
  };
}

/** An amount is allowed only when it fits inside what is left. */
export function assertRefundAmount(amountMinor: number, remainingMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw refundNotAllowed('A refund must be a positive integer of minor units.');
  }
  if (amountMinor > remainingMinor) {
    throw refundNotAllowed(
      `A refund of ${amountMinor} exceeds the refundable amount of ${remainingMinor}.`,
    );
  }
}

/** After this refund, is the captured amount fully returned? */
export function isFullyRefunded(capturedMinor: number, refundedAfterMinor: number): boolean {
  return refundedAfterMinor >= capturedMinor;
}

export function assertReason(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const reason = value.trim();
  if (reason.length === 0) {
    return null;
  }
  if (reason.length > MAX_REFUND_REASON_LENGTH) {
    throw refundInvalidRequest(
      `A refund reason must be at most ${MAX_REFUND_REASON_LENGTH} characters.`,
    );
  }
  return reason;
}
