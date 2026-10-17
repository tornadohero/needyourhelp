import type {
  RefundListResponse,
  RefundRequestResponse,
  RefundResponse,
} from '@mentor/api-contracts';

import type { Refund } from '../domain/refund.model';

/**
 * Response mappers for refunds.
 *
 * Allowlists, never ORM serialization (`AGENTS.md` §10): amounts are the
 * server's own integers and the provider reference is an opaque id, never a
 * credential.
 */
export function toRefundResponse(refund: Refund): RefundResponse {
  return {
    id: refund.id,
    orderId: refund.orderId,
    paymentId: refund.paymentId,
    amountMinor: refund.amountMinor,
    reason: refund.reason,
    status: refund.status,
    providerRef: refund.providerRef,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

export function toRefundListResponse(result: {
  items: Refund[];
  total: number;
}): RefundListResponse {
  return { items: result.items.map(toRefundResponse), total: result.total };
}

export function toRefundRequestResponse(result: {
  orderId: string;
  orderStatus: string;
  refundableMinor: number;
}): RefundRequestResponse {
  return {
    orderId: result.orderId,
    orderStatus: result.orderStatus,
    refundableMinor: result.refundableMinor,
  };
}
