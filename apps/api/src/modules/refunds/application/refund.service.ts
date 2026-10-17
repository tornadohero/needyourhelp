import { Inject, Injectable } from '@nestjs/common';

import { IDEMPOTENCY_STORE } from '../../../common/idempotency/idempotency.store';
import type { IdempotencyStore } from '../../../common/idempotency/idempotency.store';
import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { OrderService } from '../../orders/application/order.service';
import { PAYMENT_GATEWAY } from '../../payments/domain/payment-gateway';
import type { PaymentGateway } from '../../payments/domain/payment-gateway';
import { PAYMENT_REPOSITORY } from '../../payments/domain/payment.repository';
import type { PaymentRepository } from '../../payments/domain/payment.repository';
import {
  assertReason,
  assertRefundAmount,
  assertRefundable,
  calculateRefundable,
  isFullyRefunded,
} from '../domain/refund-policy';
import { REFUND_REPOSITORY } from '../domain/refund.repository';
import type { RefundRepository } from '../domain/refund.repository';
import type { Refund } from '../domain/refund.model';
import { refundForbidden, refundNotAllowed, refundNotFound } from '../domain/refund.errors';

export interface RefundDecisionContext {
  /** The admin/ops account performing the refund: the audited actor. */
  actorUserId: string;
  requestId: string;
  ipHash?: string | null;
}

export interface ExecuteRefundCommand {
  /** Optional: defaults to everything still refundable, computed server-side. */
  amountMinor?: number;
  reason?: string | null;
  idempotencyKey?: string;
}

const IDEMPOTENCY_SCOPES = {
  request: 'refunds.request',
  execute: 'refunds.execute',
} as const;

/**
 * Refunds (`specs/08-payment-and-settlement.md` §Refund,
 * `specs/05-api-spec.md` §Refund / §Admin).
 *
 * Two commands, and only one of them moves money:
 * - the customer *requests* a refund, which puts the order in `REFUND_PENDING`;
 * - an admin *executes* it (`specs/12-admin-spec.md`: "initiate refund when
 *   authorized"), which is the audited decision that calls the gateway.
 *
 * The amount is always the server's arithmetic: captured minus what already
 * moved back, never more.
 */
@Injectable()
export class RefundService {
  constructor(
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotency: IdempotencyStore,
  ) {}

  /**
   * `POST /orders/:id/refund-request`: the buyer asks, the money does not move.
   */
  async requestRefund(
    buyerUserId: string,
    orderId: string,
    options: { reason?: string | null; idempotencyKey?: string } = {},
  ): Promise<{ orderId: string; orderStatus: string; refundableMinor: number }> {
    const reason = assertReason(options.reason);

    const work = async (): Promise<{
      orderId: string;
      orderStatus: string;
      refundableMinor: number;
    }> => {
      // Only the buyer of the order may ask; a stranger gets "not found".
      const order = await this.orders.getForParticipant(buyerUserId, orderId);
      if (order.buyerUserId !== buyerUserId) {
        throw refundForbidden('Only the buyer can request a refund.');
      }

      const payment = await this.payments.findLatestByOrder(order.id);
      assertRefundable(order.status, payment?.status ?? 'NONE');

      const refundable = await this.refundableAmount(order.id, payment?.amountMinor ?? 0);
      const updated = await this.orders.beginRefund(order.id);

      return {
        orderId: updated.id,
        orderStatus: updated.status,
        refundableMinor: refundable.remainingMinor,
      };
    };

    if (!options.idempotencyKey) {
      return work();
    }

    const { result } = await this.idempotency.runOnce(
      {
        scope: IDEMPOTENCY_SCOPES.request,
        key: options.idempotencyKey,
        fingerprint: `${buyerUserId}:${orderId}:${reason ?? ''}`,
      },
      work,
    );
    return result;
  }

  /**
   * `POST /admin/orders/:id/refund`: the audited command that moves money.
   *
   * Order of operations is the one `specs/08` §Refund prescribes: state and
   * policy, refundable amount, refund record, gateway, confirmation, then the
   * order state and the audit row.
   */
  async executeRefund(
    context: RefundDecisionContext,
    orderId: string,
    command: ExecuteRefundCommand = {},
  ): Promise<Refund> {
    const reason = assertReason(command.reason);

    const work = async (): Promise<Refund> => {
      const order = await this.orders.findById(orderId);
      if (!order) {
        throw refundNotFound();
      }

      const payment = await this.payments.findLatestByOrder(order.id);
      assertRefundable(order.status, payment?.status ?? 'NONE');
      if (!payment) {
        throw refundNotAllowed('Only a paid order can be refunded.');
      }

      const refundable = await this.refundableAmount(order.id, payment.amountMinor);
      // No amount given means "everything still refundable" — the server decides.
      const amountMinor = command.amountMinor ?? refundable.remainingMinor;
      assertRefundAmount(amountMinor, refundable.remainingMinor);

      await this.orders.beginRefund(order.id);

      const refund = await this.refunds.create({
        orderId: order.id,
        paymentId: payment.id,
        amountMinor,
        reason,
      });

      const result = await this.gateway.refund({
        providerTransactionId: payment.providerTransactionId ?? '',
        amountMinor,
        reason,
      });

      const updated = await this.refunds.markStatus(refund.id, result.status, result.providerRef);

      const refundedAfter =
        refundable.refundedMinor +
        (updated.status === 'SUCCEEDED' || updated.status === 'PROCESSING' ? amountMinor : 0);

      // Only a fully returned payment closes the order; a partial one stays in
      // the refund branch so the remainder can still be refunded.
      const closedOrder =
        updated.status === 'SUCCEEDED' && isFullyRefunded(refundable.capturedMinor, refundedAfter)
          ? await this.orders.completeRefund(order.id)
          : order;

      await this.audit.record({
        actorUserId: context.actorUserId,
        actorType: 'ADMIN',
        action: AUDIT_ACTIONS.refundInitiated,
        resourceType: 'refund',
        resourceId: updated.id,
        beforeJson: {
          orderStatus: order.status,
          capturedMinor: refundable.capturedMinor,
          refundedMinor: refundable.refundedMinor,
        },
        afterJson: {
          orderStatus: closedOrder.status,
          amountMinor,
          refundStatus: updated.status,
          refundedMinor: refundedAfter,
          providerRef: updated.providerRef,
          reason,
        },
        ipHash: context.ipHash ?? null,
        requestId: context.requestId,
      });

      return updated;
    };

    if (!command.idempotencyKey) {
      return work();
    }

    const { result } = await this.idempotency.runOnce(
      {
        scope: IDEMPOTENCY_SCOPES.execute,
        key: command.idempotencyKey,
        fingerprint: `${orderId}:${command.amountMinor ?? 'full'}:${reason ?? ''}`,
      },
      work,
    );
    return result;
  }

  /** `GET /orders/:id/refunds`: buyer and provider of the order see them. */
  async listRefunds(userId: string, orderId: string): Promise<{ items: Refund[]; total: number }> {
    const order = await this.orders.getForParticipant(userId, orderId);
    const items = await this.refunds.listByOrder(order.id);
    return { items, total: items.length };
  }

  private async refundableAmount(orderId: string, capturedMinor: number) {
    const alreadyRefunded = await this.refunds.sumRefundedByOrder(orderId);
    return calculateRefundable(capturedMinor, alreadyRefunded);
  }
}
