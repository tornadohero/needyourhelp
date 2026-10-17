/**
 * Domain view of `refunds` (`specs/04-database-spec.md` §refunds,
 * `specs/08-payment-and-settlement.md` §Refund).
 *
 * A refund is one money movement back to the customer. The amount is always the
 * server's arithmetic: it can never exceed what the payment captured
 * (`AGENTS.md` §7: money is calculated server-side).
 */

export type RefundStatus = 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';

export interface Refund {
  id: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  reason: string | null;
  status: RefundStatus;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRefundInput {
  orderId: string;
  paymentId: string;
  amountMinor: number;
  reason: string | null;
}

/** What the server computed before touching the gateway. */
export interface RefundableAmount {
  /** What the payment captured. */
  capturedMinor: number;
  /** What has already moved back (succeeded or in flight). */
  refundedMinor: number;
  /** What may still be refunded. */
  remainingMinor: number;
}
