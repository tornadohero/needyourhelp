/**
 * Domain view of the order aggregate
 * (`specs/02-domain-model.md` §Order aggregate: "Owns commercial lifecycle. It
 * is the source of truth for order status";
 * `specs/04-database-spec.md` §orders).
 *
 * Money is decided here, once, at creation: what follows is a snapshot nothing
 * may recompute (`specs/08-payment-and-settlement.md` §Create payment:
 * "Recalculate amount" is the server's own arithmetic, never the client's).
 */

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'DISPUTED';

export type OrderDomain = 'TUTORING' | 'CAREER';

/** What the service cost when the order was placed. */
export interface OrderPriceSnapshot {
  serviceId: string;
  title: string;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
}

/** The commercial rules applied to this order, versioned. */
export interface OrderPolicySnapshot {
  /** Fee rule version (`AGENTS.md` §8: every fee version is recorded). */
  feeVersion: string;
  feeRateBps: number;
  cancellationPolicyId: string | null;
}

export interface Order {
  id: string;
  orderNo: string;
  buyerUserId: string;
  providerId: string;
  serviceId: string;
  childId: string | null;
  domain: OrderDomain;
  status: OrderStatus;
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  currency: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  priceSnapshot: OrderPriceSnapshot;
  policySnapshot: OrderPolicySnapshot;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderInput {
  orderNo: string;
  buyerUserId: string;
  providerId: string;
  serviceId: string;
  childId: string | null;
  domain: OrderDomain;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
  currency: string;
  priceSnapshot: OrderPriceSnapshot;
  policySnapshot: OrderPolicySnapshot;
}

export interface OrderPage {
  items: Order[];
  total: number;
}

/** The money of an order, all in minor units. */
export interface OrderMoney {
  amountMinor: number;
  platformFeeMinor: number;
  providerAmountMinor: number;
}
