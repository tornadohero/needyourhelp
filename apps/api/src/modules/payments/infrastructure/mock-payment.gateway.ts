import { randomUUID } from 'node:crypto';

import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import type {
  CreatePaymentInput,
  PaymentGateway,
  PaymentQueryResult,
  PaymentSession,
  RefundInput,
  RefundResult,
} from '../domain/payment-gateway';

/**
 * Deterministic payment adapter for local, development and test environments
 * (`specs/03-architecture-spec.md` §External provider ports; the `MOCK` provider
 * of `payments.provider`).
 *
 * It holds no credentials and stores no secrets; production refuses it, so a
 * mock can never become a production code path (`AGENTS.md` §15).
 */
export class MockPaymentGateway implements PaymentGateway {
  /** Observable in tests: what the platform asked the provider for. */
  readonly created: CreatePaymentInput[] = [];
  readonly refunds: RefundInput[] = [];

  /**
   * Transaction ids the provider considers paid, with the captured amount.
   *
   * A test drives success through this seam, so the payment flow can be
   * exercised end to end without a network.
   */
  private readonly paid = new Map<string, number>();

  constructor(private readonly options: { environment?: string } = {}) {}

  async createMiniProgramPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    this.assertAllowed();
    this.created.push(input);

    const providerTransactionId = `mock-txn-${randomUUID()}`;
    return {
      providerTransactionId,
      prepayReference: `mock-prepay-${providerTransactionId}`,
      // Opaque to the platform and free of any secret.
      params: { timeStamp: String(Date.now()), nonceStr: randomUUID(), package: 'prepay_id=mock' },
    };
  }

  async queryPayment(input: { providerTransactionId: string }): Promise<PaymentQueryResult> {
    this.assertAllowed();

    const amountMinor = this.paid.get(input.providerTransactionId);
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
    this.assertAllowed();
    this.refunds.push(input);
    return { providerRef: `mock-refund-${randomUUID()}`, status: 'SUCCEEDED' };
  }

  /** Test seam: mark a provider transaction as captured by the provider. */
  markPaid(providerTransactionId: string, amountMinor: number): void {
    this.paid.set(providerTransactionId, amountMinor);
  }

  private assertAllowed(): void {
    if (!isMockAdapterAllowed(this.options.environment)) {
      throw new Error(
        'MockPaymentGateway is not allowed in production; configure a real payment adapter.',
      );
    }
  }
}
