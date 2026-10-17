import type {
  OrderListResponse,
  OrderPriceSnapshotResponse,
  OrderResponse,
} from '@mentor/api-contracts';

import type { Order, OrderPriceSnapshot } from '../domain/order.model';

/**
 * Response mappers for orders.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). The money is always the server's arithmetic, and the price
 * snapshot is what the customer actually booked — never a live price.
 */
export function toOrderPriceSnapshotResponse(
  snapshot: OrderPriceSnapshot,
): OrderPriceSnapshotResponse {
  return {
    serviceId: snapshot.serviceId,
    title: snapshot.title,
    priceMinor: snapshot.priceMinor,
    currency: snapshot.currency,
    durationMinutes: snapshot.durationMinutes,
  };
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    orderNo: order.orderNo,
    buyerUserId: order.buyerUserId,
    providerId: order.providerId,
    serviceId: order.serviceId,
    childId: order.childId,
    domain: order.domain,
    status: order.status,
    amountMinor: order.amountMinor,
    platformFeeMinor: order.platformFeeMinor,
    providerAmountMinor: order.providerAmountMinor,
    currency: order.currency,
    scheduledStart: order.scheduledStart ? order.scheduledStart.toISOString() : null,
    scheduledEnd: order.scheduledEnd ? order.scheduledEnd.toISOString() : null,
    priceSnapshot: toOrderPriceSnapshotResponse(order.priceSnapshot),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toOrderListResponse(result: {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}): OrderListResponse {
  return {
    items: result.items.map(toOrderResponse),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}
