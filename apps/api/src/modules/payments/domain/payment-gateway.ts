/**
 * The payment adapter port (`specs/03-architecture-spec.md` §External provider
 * ports, `specs/08-payment-and-settlement.md` §Payment architecture).
 *
 * The core domain never depends on a vendor SDK: the gateway is the only thing
 * that knows how a payment is created, queried and refunded.
 */

/** Dependency-injection token for {@link PaymentGateway}. */
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

export interface CreatePaymentInput {
  orderId: string;
  orderNo: string;
  /** Always the server's arithmetic, never a client value. */
  amountMinor: number;
  currency: string;
  description: string;
  /**
   * The WeChat JSAPI flow charges a specific payer, so the adapter needs the
   * payer's openid. The platform does not persist one today (T003 stores only a
   * keyed hash), which is the open decision recorded in T015.
   */
  payerOpenId?: string;
  /** Forwarded so the provider can deduplicate (`specs/03` §Idempotency). */
  idempotencyKey?: string;
}

/** What the mini program needs to invoke the provider's cashier. */
export interface PaymentSession {
  /** The provider's own transaction id, recorded with the payment. */
  providerTransactionId: string;
  prepayReference: string;
  /** Opaque, provider-specific parameters; no secret is ever stored. */
  params: Record<string, unknown>;
}

export type PaymentQueryStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED';

export interface PaymentQueryResult {
  providerTransactionId: string;
  status: PaymentQueryStatus;
  /** The amount the provider actually captured. */
  amountMinor: number;
  paidAt: Date | null;
}

export interface RefundInput {
  providerTransactionId: string;
  amountMinor: number;
  reason: string | null;
}

export interface RefundResult {
  providerRef: string;
  status: 'REQUESTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';
}

export interface PaymentGateway {
  createMiniProgramPayment(input: CreatePaymentInput): Promise<PaymentSession>;

  /** Server-side confirmation, independent of what the client claims. */
  queryPayment(input: { providerTransactionId: string }): Promise<PaymentQueryResult>;

  /** Owned by refunds (T016); the port exists so the adapter stays complete. */
  refund(input: RefundInput): Promise<RefundResult>;
}
