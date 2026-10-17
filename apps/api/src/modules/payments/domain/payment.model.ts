/**
 * Domain view of `payments` (`specs/04-database-spec.md` §payments,
 * `specs/08-payment-and-settlement.md`).
 *
 * A payment is the platform's record of one provider transaction. The order is
 * only marked `PAID` when the server has confirmed it — through the callback or
 * through the provider query — never because a client said so.
 */

export type PaymentProvider = 'WECHAT' | 'MOCK';

export type PaymentStatus = 'INITIATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED';

export interface Payment {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  providerTransactionId: string | null;
  status: PaymentStatus;
  amountMinor: number;
  prepayReference: string | null;
  paidAt: Date | null;
  /** Reference to the stored raw notification; the payload is never inlined. */
  rawCallbackRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentInput {
  orderId: string;
  provider: PaymentProvider;
  providerTransactionId: string | null;
  amountMinor: number;
  prepayReference: string | null;
}

/** What a callback or a provider query reported. */
export interface PaymentConfirmation {
  providerTransactionId: string;
  amountMinor: number;
  paidAt: Date;
  rawCallbackRef: string | null;
}
