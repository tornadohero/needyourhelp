import type {
  PaymentNotificationResponse,
  PaymentSessionResponse,
  PaymentStatusResponse,
} from '@mentor/api-contracts';

import type { Order } from '../../orders/domain/order.model';
import type { Payment } from '../domain/payment.model';
import type { PaymentSessionResult } from '../application/payment.service';

/**
 * Response mappers for payments.
 *
 * Allowlists, never ORM serialization (`AGENTS.md` §10). The amount shown is
 * always the order's: there is no path by which a client value reaches here.
 */
export function toPaymentSessionResponse(result: PaymentSessionResult): PaymentSessionResponse {
  return {
    paymentId: result.payment.id,
    orderId: result.payment.orderId,
    orderNo: result.orderNo,
    provider: result.payment.provider,
    providerTransactionId: result.payment.providerTransactionId,
    amountMinor: result.amountMinor,
    currency: result.currency,
    status: result.payment.status,
    params: result.params,
    reused: result.reused,
    createdAt: result.payment.createdAt.toISOString(),
  };
}

export function toPaymentStatusResponse(input: {
  order: Order;
  payment: Payment | null;
  amountMinor: number;
  currency: string;
}): PaymentStatusResponse {
  return {
    orderId: input.order.id,
    orderStatus: input.order.status,
    amountMinor: input.amountMinor,
    currency: input.currency,
    payment: input.payment
      ? {
          id: input.payment.id,
          provider: input.payment.provider,
          status: input.payment.status,
          amountMinor: input.payment.amountMinor,
          paidAt: input.payment.paidAt ? input.payment.paidAt.toISOString() : null,
          providerTransactionId: input.payment.providerTransactionId,
        }
      : null,
  };
}

export function toPaymentNotificationResponse(input: {
  orderNo: string;
  orderStatus: string;
  paymentStatus: string;
  applied: boolean;
}): PaymentNotificationResponse {
  return {
    orderNo: input.orderNo,
    orderStatus: input.orderStatus,
    paymentStatus: input.paymentStatus as PaymentNotificationResponse['paymentStatus'],
    applied: input.applied,
  };
}
