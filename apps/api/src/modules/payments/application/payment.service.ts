import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { IDEMPOTENCY_STORE } from '../../../common/idempotency/idempotency.store';
import type { IdempotencyStore } from '../../../common/idempotency/idempotency.store';
import { OrderService } from '../../orders/application/order.service';
import {
  IDEMPOTENCY_SCOPES,
  assertAmountMatches,
  isOpen,
  normalizeOrderNumber,
} from '../domain/payment-policy';
import { PAYMENT_NOTIFICATION_VERIFIER } from '../domain/payment-notification-verifier';
import type {
  NotificationHeaders,
  PaymentNotificationVerifier,
} from '../domain/payment-notification-verifier';
import {
  orderNotPayable,
  paymentCallbackInvalid,
  paymentFailed,
  paymentForbidden,
} from '../domain/payment.errors';
import { PAYMENT_REPOSITORY } from '../domain/payment.repository';
import type { PaymentRepository } from '../domain/payment.repository';
import type { Payment } from '../domain/payment.model';
import { PAYMENT_GATEWAY } from '../domain/payment-gateway';
import type { PaymentGateway } from '../domain/payment-gateway';

export interface CreateSessionCommand {
  orderId: string;
  idempotencyKey?: string;
}

export interface PaymentSessionResult {
  payment: Payment;
  orderNo: string;
  amountMinor: number;
  currency: string;
  params: Record<string, unknown>;
  reused: boolean;
}

/**
 * Payments (`specs/08-payment-and-settlement.md`, `specs/05-api-spec.md`
 * §Payments).
 *
 * The order is the source of truth for the amount and for the `PAID` state; the
 * payment record only tracks what the provider did. Nothing here reads a
 * client-supplied amount, and the only thing that marks an order paid is a
 * server-side confirmation: the notification or the provider query.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PAYMENT_NOTIFICATION_VERIFIER)
    private readonly verifier: PaymentNotificationVerifier,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotency: IdempotencyStore,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /**
   * `POST /orders/:id/payment-session`.
   *
   * Order of operations is the one `specs/08` prescribes: authenticated buyer,
   * ownership, order state, server-calculated amount, idempotency key, then the
   * gateway.
   */
  async createSession(
    buyerUserId: string,
    command: CreateSessionCommand,
  ): Promise<PaymentSessionResult> {
    const order = await this.orders.getForParticipant(buyerUserId, command.orderId);

    // Only the buyer pays, and only an order that is still unpaid.
    if (order.buyerUserId !== buyerUserId) {
      throw paymentForbidden('Only the buyer can pay for an order.');
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw orderNotPayable(`An order in status ${order.status} cannot be paid.`);
    }

    const work = async (): Promise<PaymentSessionResult> => {
      // An open session is reused: paying twice must not open two transactions.
      const existing = await this.payments.findLatestByOrder(order.id);
      if (existing && isOpen(existing.status)) {
        return {
          payment: existing,
          orderNo: order.orderNo,
          amountMinor: existing.amountMinor,
          currency: order.currency,
          params: { prepayReference: existing.prepayReference, reused: true },
          reused: true,
        };
      }

      const session = await this.gateway.createMiniProgramPayment({
        orderId: order.id,
        orderNo: order.orderNo,
        // "Recalculate amount": the order's own arithmetic, never the client's.
        amountMinor: order.amountMinor,
        currency: order.currency,
        description: order.priceSnapshot.title,
        idempotencyKey: command.idempotencyKey,
      });

      const payment = await this.payments.create({
        orderId: order.id,
        provider: 'MOCK',
        providerTransactionId: session.providerTransactionId,
        amountMinor: order.amountMinor,
        prepayReference: session.prepayReference,
      });

      await this.analytics?.track({
        name: 'payment_started',
        actorUserId: buyerUserId,
        orderId: order.id,
        props: { amount_minor: payment.amountMinor },
      });

      return {
        payment,
        orderNo: order.orderNo,
        amountMinor: payment.amountMinor,
        currency: order.currency,
        params: session.params,
        reused: false,
      };
    };

    if (!command.idempotencyKey) {
      return work();
    }

    const { result } = await this.idempotency.runOnce(
      {
        scope: IDEMPOTENCY_SCOPES.session,
        key: command.idempotencyKey,
        fingerprint: `${buyerUserId}:${order.id}`,
      },
      work,
    );
    return result;
  }

  /**
   * `POST /payments/wechat/notify`.
   *
   * Unauthenticated by nature: everything is validated, and the amount must
   * equal the order's. A replayed callback is a no-op that still answers 200 —
   * the provider retries until it gets one.
   */
  async handleCallback(input: { headers: NotificationHeaders; body: string }): Promise<{
    orderNo: string;
    orderStatus: string;
    paymentStatus: string;
    applied: boolean;
  }> {
    // Signature (and, for WeChat, decryption) is the adapter's job: nothing
    // unverified reaches an order.
    const payload = await this.verifier.verify(input);

    const payment = await this.payments.findByProviderTransactionId(payload.providerTransactionId);
    if (!payment) {
      throw paymentCallbackInvalid(
        `No payment session for transaction ${payload.providerTransactionId}.`,
      );
    }

    // The order is read through the payment's own reference, and the
    // notification's order number must still agree with it.
    const order = await this.orders.findById(payment.orderId);
    if (!order) {
      throw paymentCallbackInvalid(`Unknown order for ${payload.providerTransactionId}.`);
    }
    if (normalizeOrderNumber(order.orderNo) !== normalizeOrderNumber(payload.orderNo)) {
      throw paymentCallbackInvalid('The notification does not belong to this order.');
    }

    // Already confirmed: return the stored answer, change nothing.
    if (payment.status === 'SUCCEEDED') {
      return {
        orderNo: order.orderNo,
        orderStatus: order.status,
        paymentStatus: payment.status,
        applied: false,
      };
    }

    if (payload.status !== 'SUCCEEDED') {
      // Recorded as a failed attempt; the order stays unpaid.
      await this.payments.markStatus(payment.id, 'FAILED');
      throw paymentFailed(
        `The provider reported ${payload.status} for ${payload.providerTransactionId}.`,
      );
    }

    // Amount mismatch => reject, and never mark the order paid.
    assertAmountMatches(order.amountMinor, payload.amountMinor);

    const { result } = await this.idempotency.runOnce(
      {
        scope: IDEMPOTENCY_SCOPES.callback,
        key: payload.providerTransactionId,
        fingerprint: `${order.id}:${payload.amountMinor}`,
      },
      async () => {
        const succeeded = await this.payments.markSucceeded(payment.id, {
          providerTransactionId: payload.providerTransactionId,
          amountMinor: payload.amountMinor,
          paidAt: new Date(),
          rawCallbackRef: payload.rawRef,
        });
        // The order moves once; `markPaid` is idempotent itself.
        const paid = await this.orders.markPaid(order.id);

        await this.analytics?.track({
          name: 'payment_succeeded',
          orderId: order.id,
          props: { amount_minor: succeeded.amountMinor },
        });

        return { succeeded, paid };
      },
    );

    return {
      orderNo: order.orderNo,
      orderStatus: result.paid.status,
      paymentStatus: result.succeeded.status,
      applied: true,
    };
  }

  /**
   * `GET /orders/:id/payment-status`.
   *
   * The server asks the provider as well: a notification can be lost, so the
   * authoritative answer is the provider's own record
   * (`specs/08`: "Server confirms through payment notification/query").
   */
  async getStatus(buyerUserId: string, orderId: string) {
    const order = await this.orders.getForParticipant(buyerUserId, orderId);
    if (order.buyerUserId !== buyerUserId) {
      throw paymentForbidden('Only the buyer can read the payment status.');
    }

    const payment = await this.payments.findLatestByOrder(order.id);

    if (payment && isOpen(payment.status) && payment.providerTransactionId) {
      const queried = await this.gateway.queryPayment({
        providerTransactionId: payment.providerTransactionId,
      });

      if (queried.status === 'SUCCEEDED') {
        // Same guard as the callback: the captured amount must match.
        assertAmountMatches(order.amountMinor, queried.amountMinor);
        const succeeded = await this.payments.markSucceeded(payment.id, {
          providerTransactionId: queried.providerTransactionId,
          amountMinor: queried.amountMinor,
          paidAt: queried.paidAt ?? new Date(),
          rawCallbackRef: null,
        });
        const paidOrder = await this.orders.markPaid(order.id);
        return {
          order: paidOrder,
          payment: succeeded,
          amountMinor: paidOrder.amountMinor,
          currency: paidOrder.currency,
        };
      }

      if (queried.status === 'FAILED' || queried.status === 'CLOSED') {
        const failed = await this.payments.markStatus(payment.id, 'FAILED');
        return {
          order,
          payment: failed,
          amountMinor: order.amountMinor,
          currency: order.currency,
        };
      }
    }

    return {
      order,
      payment,
      amountMinor: order.amountMinor,
      currency: order.currency,
    };
  }
}
