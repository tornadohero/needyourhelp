import type { OrderResponse, RefundResponse } from '@mentor/api-contracts';
import { ORDER_STATUSES, REFUND_STATUSES } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  ORDER_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  actionsFor,
  describeOrder,
  describeOrderDetail,
  describeRefund,
} from './order-view';

function order(overrides: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 'order-1',
    orderNo: 'MP202610210001',
    buyerUserId: 'user-1',
    providerId: 'provider-1',
    serviceId: 'service-1',
    childId: null,
    domain: 'TUTORING',
    status: 'PENDING_PAYMENT',
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: '2026-11-01T02:00:00.000Z',
    scheduledEnd: '2026-11-01T03:00:00.000Z',
    priceSnapshot: {
      serviceId: 'service-1',
      title: '初中数学一对一',
      priceMinor: 20_000,
      currency: 'CNY',
      durationMinutes: 60,
    },
    createdAt: '2026-10-21T02:00:00.000Z',
    updatedAt: '2026-10-21T02:00:00.000Z',
    ...overrides,
  };
}

describe('order status labels', () => {
  it('has a label for every status the contract declares', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it('has a label for every refund status the contract declares', () => {
    for (const status of REFUND_STATUSES) {
      expect(REFUND_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe('actionsFor', () => {
  it('offers cancel only before payment, and a refund only after it', () => {
    expect(actionsFor('PENDING_PAYMENT')).toEqual({
      canPay: true,
      canCancel: true,
      canRequestRefund: false,
    });
    expect(actionsFor('PAID')).toEqual({
      canPay: false,
      canCancel: false,
      canRequestRefund: true,
    });
    expect(actionsFor('CONFIRMED').canRequestRefund).toBe(true);
    expect(actionsFor('IN_PROGRESS').canRequestRefund).toBe(true);
  });

  it('offers nothing once the order is over', () => {
    for (const status of ['COMPLETED', 'REFUNDED', 'CANCELLED', 'DISPUTED'] as const) {
      expect(actionsFor(status)).toEqual({
        canPay: false,
        canCancel: false,
        canRequestRefund: false,
      });
    }
  });
});

describe('describeOrder', () => {
  it('formats the server’s money without recomputing it', () => {
    const view = describeOrder(order({ amountMinor: 20_000 }));

    expect(view.amountText).toBe('¥200.00');
    // The platform fee is not a customer-facing number here, so it never shows.
    expect(JSON.stringify(view)).not.toContain('18000');
  });

  it('shows the status and the order number a screen must show', () => {
    const view = describeOrder(order({ status: 'PAID' }));

    expect(view.statusText).toBe('已支付');
    expect(view.orderNo).toBe('MP202610210001');
    expect(view.title).toBe('初中数学一对一');
  });

  it('leaves the time empty instead of inventing one', () => {
    const view = describeOrder(order({ scheduledStart: null, scheduledEnd: null }));
    expect(view.timeText).toBe('');
  });
});

describe('describeOrderDetail', () => {
  it('shows the money screen: service, duration, unit price, total, order number', () => {
    const view = describeOrderDetail(order());

    expect(view.durationText).toBe('1 小时');
    expect(view.unitPriceText).toBe('¥200.00');
    expect(view.totalText).toBe('¥200.00');
    expect(view.orderNo).toBe('MP202610210001');
  });

  it('keeps the snapshot price even when the total differs', () => {
    // A discount or a fee change must not rewrite history: the snapshot is what
    // was agreed at booking time.
    const view = describeOrderDetail(order({ amountMinor: 18_000 }));

    expect(view.unitPriceText).toBe('¥200.00');
    expect(view.totalText).toBe('¥180.00');
  });

  it('says a child is attached without naming the child', () => {
    expect(describeOrderDetail(order({ childId: null })).childText).toBe('未关联孩子档案');
    expect(describeOrderDetail(order({ childId: 'child-1' })).childText).toBe('已关联孩子档案');
  });
});

describe('describeRefund', () => {
  it('shows the status and the amount the server refunded', () => {
    const refund: RefundResponse = {
      id: 'refund-1',
      orderId: 'order-1',
      paymentId: 'payment-1',
      amountMinor: 20_000,
      reason: null,
      status: 'SUCCEEDED',
      providerRef: null,
      createdAt: '2026-10-21T04:00:00.000Z',
      updatedAt: '2026-10-21T04:00:00.000Z',
    };

    const view = describeRefund(refund);
    expect(view.statusText).toBe('已退款');
    expect(view.amountText).toBe('¥200.00');
    expect(view.reasonText).toBe('');
  });
});
