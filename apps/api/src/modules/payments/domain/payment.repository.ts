import type {
  CreatePaymentInput,
  Payment,
  PaymentConfirmation,
  PaymentStatus,
} from './payment.model';

/** Dependency-injection token for {@link PaymentRepository}. */
export const PAYMENT_REPOSITORY = 'PAYMENT_REPOSITORY';

export interface PaymentRepository {
  create(input: CreatePaymentInput): Promise<Payment>;

  findById(id: string): Promise<Payment | null>;

  /** One provider transaction is recorded once (`provider_transaction_id`). */
  findByProviderTransactionId(providerTransactionId: string): Promise<Payment | null>;

  /** The most recent payment attempt of an order. */
  findLatestByOrder(orderId: string): Promise<Payment | null>;

  listByOrder(orderId: string): Promise<Payment[]>;

  /**
   * Mark an attempt succeeded.
   *
   * Idempotent on purpose: replaying a callback must not produce a second
   * transition, so this returns the payment as it is when it is already
   * `SUCCEEDED`.
   */
  markSucceeded(id: string, confirmation: PaymentConfirmation): Promise<Payment>;

  markStatus(id: string, status: PaymentStatus): Promise<Payment>;
}
