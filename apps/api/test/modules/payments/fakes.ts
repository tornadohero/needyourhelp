import type {
  CreatePaymentInput,
  Payment,
  PaymentConfirmation,
  PaymentStatus,
} from '../../../src/modules/payments/domain/payment.model';
import type { PaymentRepository } from '../../../src/modules/payments/domain/payment.repository';
import type {
  CreatePaymentInput as GatewayCreateInput,
  PaymentGateway,
  PaymentQueryResult,
  PaymentSession,
  RefundInput,
  RefundResult,
} from '../../../src/modules/payments/domain/payment-gateway';

/** In-memory {@link PaymentRepository}. */
export class FakePaymentRepository implements PaymentRepository {
  readonly payments = new Map<string, Payment>();
  private sequence = 0;

  async create(input: CreatePaymentInput): Promise<Payment> {
    this.sequence += 1;
    const now = new Date();
    const payment: Payment = {
      id: `00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`,
      orderId: input.orderId,
      provider: input.provider,
      providerTransactionId: input.providerTransactionId,
      // The provider has not confirmed anything yet.
      status: 'INITIATED',
      amountMinor: input.amountMinor,
      prepayReference: input.prepayReference,
      paidAt: null,
      rawCallbackRef: null,
      createdAt: now,
      updatedAt: now,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  async findById(id: string): Promise<Payment | null> {
    return this.payments.get(id) ?? null;
  }

  async findByProviderTransactionId(providerTransactionId: string): Promise<Payment | null> {
    return (
      [...this.payments.values()].find(
        (payment) => payment.providerTransactionId === providerTransactionId,
      ) ?? null
    );
  }

  async findLatestByOrder(orderId: string): Promise<Payment | null> {
    return (
      [...this.payments.values()]
        .filter((payment) => payment.orderId === orderId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null
    );
  }

  async listByOrder(orderId: string): Promise<Payment[]> {
    return [...this.payments.values()].filter((payment) => payment.orderId === orderId);
  }

  async markSucceeded(id: string, confirmation: PaymentConfirmation): Promise<Payment> {
    const current = this.payments.get(id);
    if (!current) {
      throw new Error(`unknown payment ${id}`);
    }
    // Idempotent: a replayed callback must not produce a second transition.
    if (current.status === 'SUCCEEDED') {
      return current;
    }
    const updated: Payment = {
      ...current,
      status: 'SUCCEEDED',
      providerTransactionId: confirmation.providerTransactionId,
      paidAt: confirmation.paidAt,
      rawCallbackRef: confirmation.rawCallbackRef,
      updatedAt: new Date(),
    };
    this.payments.set(id, updated);
    return updated;
  }

  async markStatus(id: string, status: PaymentStatus): Promise<Payment> {
    const current = this.payments.get(id);
    if (!current) {
      throw new Error(`unknown payment ${id}`);
    }
    const updated: Payment = { ...current, status, updatedAt: new Date() };
    this.payments.set(id, updated);
    return updated;
  }
}

/**
 * {@link PaymentGateway} that records everything.
 *
 * `paidTransactions` is the seam that decides what the provider reports, so a
 * test can drive success, failure and "still pending" without a network.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly created: GatewayCreateInput[] = [];
  readonly refunds: RefundInput[] = [];
  readonly paidTransactions = new Map<string, number>();

  async createMiniProgramPayment(input: GatewayCreateInput): Promise<PaymentSession> {
    this.created.push(input);
    const providerTransactionId = `txn-${this.created.length}`;
    return {
      providerTransactionId,
      prepayReference: `prepay-${providerTransactionId}`,
      params: { package: 'prepay_id=fake' },
    };
  }

  async queryPayment(input: { providerTransactionId: string }): Promise<PaymentQueryResult> {
    const amountMinor = this.paidTransactions.get(input.providerTransactionId);
    if (amountMinor === undefined) {
      return {
        providerTransactionId: input.providerTransactionId,
        status: 'PENDING',
        amountMinor: 0,
        paidAt: null,
      };
    }
    return {
      providerTransactionId: input.providerTransactionId,
      status: 'SUCCEEDED',
      amountMinor,
      paidAt: new Date(),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.refunds.push(input);
    return { providerRef: 'refund-1', status: 'SUCCEEDED' };
  }
}
