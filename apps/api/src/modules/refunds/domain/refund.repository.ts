import type { CreateRefundInput, Refund, RefundStatus } from './refund.model';

/** Dependency-injection token for {@link RefundRepository}. */
export const REFUND_REPOSITORY = 'REFUND_REPOSITORY';

export interface RefundRepository {
  create(input: CreateRefundInput): Promise<Refund>;

  findById(id: string): Promise<Refund | null>;

  listByOrder(orderId: string): Promise<Refund[]>;

  /** Gateway outcome, plus the provider's own reference when it has one. */
  markStatus(id: string, status: RefundStatus, providerRef?: string | null): Promise<Refund>;

  /**
   * How much has already moved back for this order.
   *
   * Only {@link MONEY_MOVING_REFUND_STATUSES} count: a failed or merely
   * requested refund has not returned any money, so it cannot reduce what is
   * still refundable.
   */
  sumRefundedByOrder(orderId: string, statuses?: readonly RefundStatus[]): Promise<number>;
}
