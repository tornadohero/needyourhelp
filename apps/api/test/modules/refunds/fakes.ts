import type {
  CreateRefundInput,
  Refund,
  RefundStatus,
} from '../../../src/modules/refunds/domain/refund.model';
import type { RefundRepository } from '../../../src/modules/refunds/domain/refund.repository';
import { MONEY_MOVING_REFUND_STATUSES } from '../../../src/modules/refunds/domain/refund-policy';
import type {
  CreatePaymentInput as GatewayCreateInput,
  PaymentGateway,
  PaymentQueryResult,
  PaymentSession,
  RefundInput,
  RefundResult,
} from '../../../src/modules/payments/domain/payment-gateway';

/** In-memory {@link RefundRepository}. */
export class FakeRefundRepository implements RefundRepository {
  readonly refunds = new Map<string, Refund>();
  private sequence = 0;

  async create(input: CreateRefundInput): Promise<Refund> {
    this.sequence += 1;
    const now = new Date();
    const refund: Refund = {
      id: `00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`,
      orderId: input.orderId,
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      reason: input.reason,
      // Money has not moved yet.
      status: 'REQUESTED',
      providerRef: null,
      createdAt: now,
      updatedAt: now,
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  async findById(id: string): Promise<Refund | null> {
    return this.refunds.get(id) ?? null;
  }

  async listByOrder(orderId: string): Promise<Refund[]> {
    return [...this.refunds.values()].filter((refund) => refund.orderId === orderId);
  }

  async markStatus(id: string, status: RefundStatus, providerRef?: string | null): Promise<Refund> {
    const current = this.refunds.get(id);
    if (!current) {
      throw new Error(`unknown refund ${id}`);
    }
    const updated: Refund = {
      ...current,
      status,
      providerRef: providerRef ?? current.providerRef,
      updatedAt: new Date(),
    };
    this.refunds.set(id, updated);
    return updated;
  }

  async sumRefundedByOrder(
    orderId: string,
    statuses: readonly RefundStatus[] = MONEY_MOVING_REFUND_STATUSES,
  ): Promise<number> {
    return [...this.refunds.values()]
      .filter((refund) => refund.orderId === orderId && statuses.includes(refund.status))
      .reduce((total, refund) => total + refund.amountMinor, 0);
  }
}

/**
 * {@link PaymentGateway} for refund tests.
 *
 * `nextRefundStatus` decides what the provider reports, so failure and
 * "still processing" paths are testable.
 */
export class FakeRefundGateway implements PaymentGateway {
  readonly refunds: RefundInput[] = [];
  nextRefundStatus: RefundResult['status'] = 'SUCCEEDED';
  providerRef = 'provider-refund-1';

  async createMiniProgramPayment(): Promise<PaymentSession> {
    throw new Error('not used in refund tests');
  }

  async queryPayment(): Promise<PaymentQueryResult> {
    throw new Error('not used in refund tests');
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    this.refunds.push(input);
    return { providerRef: this.providerRef, status: this.nextRefundStatus };
  }
}

export type { GatewayCreateInput };
