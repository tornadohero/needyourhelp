/**
 * Order contract (T013).
 *
 * Source of truth: `specs/05-api-spec.md` §Orders ("Server derives price"),
 * `specs/01-business-rules.md` §Orders,
 * `specs/06-verification-state-machine.md` §Order,
 * `specs/04-database-spec.md` §orders, `specs/08-payment-and-settlement.md`
 * §Money model.
 *
 * Money is integer minor units and is always the server's arithmetic: a client
 * sends what it wants to book, never a price.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `orders.status` (`specs/06-verification-state-machine.md` §Order). */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
  'DISPUTED',
] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * What the service cost at the moment of booking.
 *
 * An order never reads a live price again: the snapshot is what the customer
 * pays and what the provider earns (`specs/04-database-spec.md` §orders).
 */
export interface OrderPriceSnapshotResponse {
  serviceId: string;
  title: string;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
}

export interface OrderResponse {
  id: string;
  orderNo: string;
  buyerUserId: string;
  providerId: string;
  serviceId: string;
  childId: string | null;
  domain: string;
  status: OrderStatusName;
  /** Integer minor units; computed by the server, never by the client. */
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  currency: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  priceSnapshot: OrderPriceSnapshotResponse;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListResponse {
  items: OrderResponse[];
  total: number;
  page: number;
  pageSize: number;
}
