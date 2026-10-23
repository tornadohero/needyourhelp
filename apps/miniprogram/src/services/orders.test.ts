import type {
  AvailabilitySlotResponse,
  OrderResponse,
  RefundResponse,
} from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import { bookingRequest, slotOptions, withService, withSlot } from '../core/booking';
import type { BookingDraft } from '../core/booking';
import { MemoryTokenStore, SessionManager } from '../core/session';
import {
  bookableSlots,
  canLoadMoreOrders,
  cancelOrder,
  createOrder,
  listOrders,
  loadMoreOrders,
  loadOrders,
  orderDetail,
  requestRefund,
} from './orders';

type Answer = { status: number; body: unknown };

function harness(answers: Answer[] = []) {
  const calls: TransportRequest[] = [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({ client, store });
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 4_102_444_800 });

  return { context: { client, session }, calls };
}

function slot(id: string): AvailabilitySlotResponse {
  return {
    id,
    providerId: 'provider-1',
    startAt: `2026-11-0${id}T02:00:00.000Z`,
    endAt: `2026-11-0${id}T03:00:00.000Z`,
    recurrenceRule: null,
    status: 'OPEN',
  };
}

function order(id: string, status: OrderResponse['status'] = 'PENDING_PAYMENT'): OrderResponse {
  return {
    id,
    orderNo: `MP20261021000${id}`,
    buyerUserId: 'user-1',
    providerId: 'provider-1',
    serviceId: 'service-1',
    childId: null,
    domain: 'TUTORING',
    status,
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
  };
}

function refund(): RefundResponse {
  return {
    id: 'refund-1',
    orderId: '1',
    paymentId: 'payment-1',
    amountMinor: 20_000,
    reason: '时间不合适',
    status: 'SUCCEEDED',
    providerRef: null,
    createdAt: '2026-10-21T05:00:00.000Z',
    updatedAt: '2026-10-21T05:00:00.000Z',
  };
}

function draft(): BookingDraft {
  let value = withService(
    {
      providerId: 'provider-1',
      serviceId: null,
      slotId: null,
      startAt: null,
      endAt: null,
      childId: null,
      note: '',
    },
    'service-1',
  );
  value = withSlot(value, slotOptions([slot('1')], new Date('2026-10-21T00:00:00.000Z'))[0]!);
  return value;
}

describe('createOrder', () => {
  it('posts the booking and sends no money', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: order('1') } }]);

    const created = await createOrder(context, draft());

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-1');

    const body = String(calls[0]?.body ?? '').toLowerCase();
    for (const forbidden of ['amount', 'price', 'fee', 'currency', 'status']) {
      expect(body).not.toContain(forbidden);
    }
    expect(created.status).toBe('PENDING_PAYMENT');
  });

  it('refuses an incomplete draft before it reaches the network', async () => {
    const { context, calls } = harness();

    await expect(createOrder(context, withService(draft(), null))).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('never sends a note that is only whitespace', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: order('1') } }]);

    await createOrder(context, { ...draft(), note: '   ' });

    expect(String(calls[0]?.body)).not.toContain('note');
  });
});

describe('bookableSlots', () => {
  it('asks the provider’s public availability and offers what is open', async () => {
    const { context, calls } = harness([
      { status: 200, body: { data: { items: [slot('1')], total: 1 } } },
    ]);

    const options = await bookableSlots(context, 'provider-1');

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/providers/provider-1/availability');
    expect(options.map((option) => option.id)).toEqual(['1']);
  });
});

describe('order list', () => {
  function pageOf(ids: string[], total: number, page: number): Answer {
    return {
      status: 200,
      body: {
        data: { items: ids.map((id) => order(id)), total, page, pageSize: 20 },
      },
    };
  }

  it('asks for a bounded page with the session attached', async () => {
    const { context, calls } = harness([pageOf(['1'], 1, 1)]);

    await listOrders(context, { page: 2, pageSize: 10 });

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders?page=2&pageSize=10');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('appends pages without duplicating a row', async () => {
    const { context } = harness([pageOf(['1', '2'], 3, 1), pageOf(['2', '3'], 3, 2)]);

    let state = await loadOrders(context);
    expect(state.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(canLoadMoreOrders(state)).toBe(true);

    const more = await loadMoreOrders(context, state);
    state = more.state;
    expect(state.items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(canLoadMoreOrders(state)).toBe(false);
  });

  it('stops asking when the list is complete', async () => {
    const { context, calls } = harness([pageOf(['1'], 1, 1)]);

    const state = await loadOrders(context);
    const more = await loadMoreOrders(context, state);

    expect(more.loaded).toBe(false);
    expect(calls.length).toBe(1);
  });
});

describe('orderDetail', () => {
  it('reads the order and its refunds, and describes both', async () => {
    const { context, calls } = harness([
      { status: 200, body: { data: order('1', 'REFUNDED') } },
      { status: 200, body: { data: { items: [refund()], total: 1 } } },
    ]);

    const { order: view, refunds } = await orderDetail(context, '1');

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/1');
    expect(calls[1]?.url).toBe('https://api.example.com/api/v1/orders/1/refunds');
    expect(view.statusText).toBe('已退款');
    expect(view.totalText).toBe('¥200.00');
    expect(refunds[0]?.statusText).toBe('已退款');
  });
});

describe('order commands', () => {
  it('cancels through the command route, never a status write', async () => {
    const { context, calls } = harness([{ status: 200, body: { data: order('1', 'CANCELLED') } }]);

    const cancelled = await cancelOrder(context, '1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/1/cancel');
    expect(calls[0]?.body).toBeUndefined();
    expect(cancelled.statusText).toBe('已取消');
  });

  it('asks for a refund without naming an amount', async () => {
    const { context, calls } = harness([
      {
        status: 200,
        body: { data: { orderId: '1', orderStatus: 'REFUND_PENDING', refundableMinor: 20_000 } },
      },
    ]);

    const answer = await requestRefund(context, '1', { reason: '时间不合适' });

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/1/refund-request');
    expect(String(calls[0]?.body)).not.toMatch(/amount|minor|price/i);
    expect(answer.orderStatus).toBe('REFUND_PENDING');
    expect(answer.refundableMinor).toBe(20_000);
  });

  it('sends no reason when none was given', async () => {
    const { context, calls } = harness([
      {
        status: 200,
        body: { data: { orderId: '1', orderStatus: 'REFUND_PENDING', refundableMinor: 20_000 } },
      },
    ]);

    await requestRefund(context, '1');

    expect(calls[0]?.body).toBe('{}');
  });
});

describe('bookingRequest is the only way to build a body', () => {
  it('is what createOrder sends, so no screen can invent a payload', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: order('1') } }]);

    const value = draft();
    await createOrder(context, value);

    expect(JSON.parse(String(calls[0]?.body))).toEqual(bookingRequest(value));
  });
});
