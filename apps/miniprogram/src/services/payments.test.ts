import type { PaymentSessionResponse, PaymentStatusResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportResponse } from '../core/http';
import { MemoryTokenStore, SessionManager } from '../core/session';
import {
  createPaymentSession,
  readPaymentStatus,
  simulateGatewayCallback,
  waitForPayment,
} from './payments';

type Answer = TransportResponse;

function harness(answers: Answer[] = []) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] =
    [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
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

function ok(data: unknown): Answer {
  return { status: 200, body: { data } };
}

function session(overrides: Partial<PaymentSessionResponse> = {}): PaymentSessionResponse {
  return {
    paymentId: 'payment-1',
    orderId: 'order-1',
    orderNo: 'MP202610230001',
    provider: 'WECHAT',
    providerTransactionId: 'txn-1',
    amountMinor: 20_000,
    currency: 'CNY',
    status: 'PENDING',
    params: { timeStamp: '1', nonceStr: 'a', package: 'prepay_id=wx', paySign: 'sig' },
    reused: false,
    createdAt: '2026-10-23T02:00:00.000Z',
    ...overrides,
  };
}

function statusResponse(paymentStatus: string): PaymentStatusResponse {
  return {
    orderId: 'order-1',
    orderStatus: paymentStatus === 'SUCCEEDED' ? 'PAID' : 'PENDING_PAYMENT',
    amountMinor: 20_000,
    currency: 'CNY',
    payment: {
      id: 'payment-1',
      provider: 'WECHAT',
      status: paymentStatus as PaymentStatusResponse['payment'] extends null
        ? never
        : 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CLOSED' | 'INITIATED',
      amountMinor: 20_000,
      paidAt: paymentStatus === 'SUCCEEDED' ? '2026-10-23T02:05:00.000Z' : null,
      providerTransactionId: 'txn-1',
    },
  };
}

describe('createPaymentSession', () => {
  it('asks the platform for a session and sends no amount', async () => {
    const { context, calls } = harness([{ status: 201, body: { data: session() } }]);

    const created = await createPaymentSession(context, 'order-1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/order-1/payment-session');
    expect(calls[0]?.body).toBeUndefined();
    expect(created.view.amountText).toBe('¥200.00');
    expect(created.payParams?.paySign).toBe('sig');
  });

  it('reports that no cashier can be opened when the signature is missing', async () => {
    const { context } = harness([
      { status: 201, body: { data: session({ provider: 'MOCK', params: {} }) } },
    ]);

    const created = await createPaymentSession(context, 'order-1');

    expect(created.view.isMock).toBe(true);
    expect(created.payParams).toBeNull();
  });
});

describe('readPaymentStatus', () => {
  it('is what the screen believes, not the client callback', async () => {
    const { context, calls } = harness([ok(statusResponse('SUCCEEDED'))]);

    const { view } = await readPaymentStatus(context, 'order-1');

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/orders/order-1/payment-status');
    expect(view.outcome).toBe('paid');
    expect(view.paymentText).toBe('支付成功');
  });
});

describe('waitForPayment', () => {
  it('asks until the server knows, then stops', async () => {
    const { context, calls } = harness([
      ok(statusResponse('PENDING')),
      ok(statusResponse('PENDING')),
      ok(statusResponse('SUCCEEDED')),
    ]);

    const outcome = await waitForPayment(context, 'order-1', {
      attempts: 5,
      intervalMs: 10,
      sleep: async () => undefined,
    });

    expect(outcome.outcome).toBe('paid');
    expect(outcome.polls).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('treats a timeout as "still unknown", never as failure', async () => {
    const { context } = harness([ok(statusResponse('PENDING')), ok(statusResponse('PENDING'))]);

    const outcome = await waitForPayment(context, 'order-1', {
      attempts: 2,
      intervalMs: 10,
      sleep: async () => undefined,
    });

    expect(outcome.outcome).toBe('pending');
    expect(outcome.view.paymentText).toBe('等待支付结果');
  });

  it('stops early on a failure instead of hoping', async () => {
    const { context, calls } = harness([ok(statusResponse('FAILED'))]);

    const outcome = await waitForPayment(context, 'order-1', {
      attempts: 5,
      sleep: async () => undefined,
    });

    expect(outcome.outcome).toBe('failed');
    expect(calls).toHaveLength(1);
  });
});

describe('simulateGatewayCallback', () => {
  it('posts what a gateway would post — mock provider only', async () => {
    const { context, calls } = harness([ok({ applied: true, orderStatus: 'PAID' })]);

    const result = await simulateGatewayCallback(context, session({ provider: 'MOCK' }));

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/payments/wechat/notify');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      orderNo: 'MP202610230001',
      providerTransactionId: 'txn-1',
      amountMinor: 20_000,
      status: 'SUCCEEDED',
    });
    expect(result.applied).toBe(true);
  });

  it('refuses to run against a real provider', async () => {
    const { context, calls } = harness([]);

    await expect(simulateGatewayCallback(context, session({ provider: 'WECHAT' }))).rejects.toThrow(
      /MOCK/,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a session with no provider transaction', async () => {
    const { context } = harness([]);

    await expect(
      simulateGatewayCallback(context, session({ provider: 'MOCK', providerTransactionId: null })),
    ).rejects.toThrow();
  });
});
