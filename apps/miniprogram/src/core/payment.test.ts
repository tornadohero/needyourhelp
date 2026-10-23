import type { PaymentSessionResponse, PaymentStatusResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  describePaymentSession,
  describePaymentStatus,
  outcomeOf,
  wechatPaymentParams,
} from './payment';

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
    params: {},
    reused: false,
    createdAt: '2026-10-23T02:00:00.000Z',
    ...overrides,
  };
}

function status(overrides: Partial<PaymentStatusResponse> = {}): PaymentStatusResponse {
  return {
    orderId: 'order-1',
    orderStatus: 'PENDING_PAYMENT',
    amountMinor: 20_000,
    currency: 'CNY',
    payment: {
      id: 'payment-1',
      provider: 'WECHAT',
      status: 'PENDING',
      amountMinor: 20_000,
      paidAt: null,
      providerTransactionId: 'txn-1',
    },
    ...overrides,
  };
}

describe('describePaymentSession', () => {
  it('shows the money the server decided and the channel it chose', () => {
    const view = describePaymentSession(session());

    expect(view.amountText).toBe('¥200.00');
    expect(view.providerText).toBe('微信支付');
    expect(view.statusText).toBe('等待支付结果');
    expect(view.orderNo).toBe('MP202610230001');
  });

  it('marks the local adapter: there is no cashier to open', () => {
    expect(describePaymentSession(session({ provider: 'MOCK' })).isMock).toBe(true);
    expect(describePaymentSession(session({ provider: 'WECHAT' })).isMock).toBe(false);
  });

  it('says when the platform reused an existing session', () => {
    expect(describePaymentSession(session({ reused: true })).reused).toBe(true);
  });
});

describe('describePaymentStatus', () => {
  it('reports the server’s answer, not the client’s callback', () => {
    const view = describePaymentStatus(status());

    expect(view.outcome).toBe('pending');
    expect(view.paymentText).toBe('等待支付结果');
  });

  it('knows a paid order from a failed one', () => {
    const paid = describePaymentStatus(
      status({
        orderStatus: 'PAID',
        payment: {
          id: 'payment-1',
          provider: 'WECHAT',
          status: 'SUCCEEDED',
          amountMinor: 20_000,
          paidAt: '2026-10-23T02:05:00.000Z',
          providerTransactionId: 'txn-1',
        },
      }),
    );

    expect(paid.outcome).toBe('paid');
    expect(paid.paidText).not.toBe('');

    const failed = describePaymentStatus(
      status({
        payment: {
          id: 'payment-1',
          provider: 'WECHAT',
          status: 'FAILED',
          amountMinor: 20_000,
          paidAt: null,
          providerTransactionId: 'txn-1',
        },
      }),
    );
    expect(failed.outcome).toBe('failed');
  });

  it('says there is no payment record at all', () => {
    expect(describePaymentStatus(status({ payment: null })).paymentText).toBe('还没有支付记录');
  });
});

describe('outcomeOf', () => {
  it('maps every status the contract declares', () => {
    expect(outcomeOf('SUCCEEDED')).toBe('paid');
    expect(outcomeOf('FAILED')).toBe('failed');
    expect(outcomeOf('CLOSED')).toBe('failed');
    expect(outcomeOf('PENDING')).toBe('pending');
    expect(outcomeOf('INITIATED')).toBe('pending');
  });
});

describe('wechatPaymentParams', () => {
  it('passes the provider’s own parameters through', () => {
    const params = wechatPaymentParams({
      timeStamp: '1700000000',
      nonceStr: 'abc',
      package: 'prepay_id=wx1',
      signType: 'RSA',
      paySign: 'signature',
      somethingElse: 'ignored',
    });

    expect(params).toEqual({
      timeStamp: '1700000000',
      nonceStr: 'abc',
      package: 'prepay_id=wx1',
      signType: 'RSA',
      paySign: 'signature',
    });
  });

  it('refuses to open a cashier without a signature', () => {
    // The mock adapter has no signature: the screen falls back to the server.
    expect(
      wechatPaymentParams({ timeStamp: '1', nonceStr: 'a', package: 'prepay_id=mock' }),
    ).toBeNull();
    expect(wechatPaymentParams({})).toBeNull();
  });
});
