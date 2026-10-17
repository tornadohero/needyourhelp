/**
 * Payment contract (T014).
 *
 * Source of truth: `specs/08-payment-and-settlement.md`,
 * `specs/03-architecture-spec.md` §External provider ports,
 * `specs/05-api-spec.md` §Payments, `specs/04-database-spec.md` §payments.
 *
 * The client callback is informational only: the server confirms success
 * through the notification and/or the provider query, and nothing here trusts a
 * client-supplied amount.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `payments.status` (`specs/08-payment-and-settlement.md` §Create payment). */
export const PAYMENT_STATUSES = ['INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED'] as const;
export type PaymentStatusName = (typeof PAYMENT_STATUSES)[number];

/** `payments.provider`. `MOCK` is the local/test adapter (T014); T015 adds the
 * real WeChat flow behind the same port. */
export const PAYMENT_PROVIDERS = ['WECHAT', 'MOCK'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * `POST /orders/:id/payment-session`.
 *
 * `params` are the provider's own payment parameters (prepay id and friends);
 * they are opaque to the platform and carry no secret.
 */
export interface PaymentSessionResponse {
  paymentId: string;
  orderId: string;
  orderNo: string;
  provider: PaymentProviderName;
  providerTransactionId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatusName;
  params: Record<string, unknown>;
  /** `true` when an existing session for this order was returned again. */
  reused: boolean;
  createdAt: string;
}

/** `GET /orders/:id/payment-status`. */
export interface PaymentStatusResponse {
  orderId: string;
  orderStatus: string;
  amountMinor: number;
  currency: string;
  payment: {
    id: string;
    provider: PaymentProviderName;
    status: PaymentStatusName;
    amountMinor: number;
    paidAt: string | null;
    providerTransactionId: string | null;
  } | null;
}

/**
 * `POST /payments/wechat/notify`.
 *
 * `applied: false` with a 200 means "already known" — a replayed callback never
 * moves the order twice (`specs/08` §Payment invariants).
 */
export interface PaymentNotificationResponse {
  orderNo: string;
  orderStatus: string;
  paymentStatus: PaymentStatusName;
  applied: boolean;
}
