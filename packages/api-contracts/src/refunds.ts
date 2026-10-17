/**
 * Refund contract (T016).
 *
 * Source of truth: `specs/08-payment-and-settlement.md` §Refund,
 * `specs/04-database-spec.md` §refunds, `specs/06-verification-state-machine.md`
 * §Order, `specs/05-api-spec.md` §Refund / §Admin.
 *
 * A refund is always a server-side calculation: the amount can never exceed what
 * was captured, and a client never states how much money moves.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `refunds.status` (`specs/08-payment-and-settlement.md` §Refund). */
export const REFUND_STATUSES = [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
] as const;
export type RefundStatusName = (typeof REFUND_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface RefundResponse {
  id: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  reason: string | null;
  status: RefundStatusName;
  providerRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundListResponse {
  items: RefundResponse[];
  total: number;
}

/**
 * `POST /orders/:id/refund-request`.
 *
 * The customer asks for a refund; the money only moves through the audited
 * admin command (`specs/12-admin-spec.md`).
 */
export interface RefundRequestResponse {
  orderId: string;
  orderStatus: string;
  /** What the server would still refund: captured minus already refunded. */
  refundableMinor: number;
}
