import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryIdempotencyStore } from '../../../src/common/idempotency/in-memory-idempotency.store';
import type { OrderService } from '../../../src/modules/orders/application/order.service';
import { PaymentService } from '../../../src/modules/payments/application/payment.service';
import { PassthroughNotificationVerifier } from '../../../src/modules/payments/infrastructure/passthrough-notification.verifier';
import { FakeOrderRepository } from '../orders/fakes';
import { FakePaymentGateway, FakePaymentRepository } from './fakes';
import type { Order } from '../../../src/modules/orders/domain/order.model';

const BUYER = '11111111-1111-4111-8111-111111111111';
const PROVIDER_OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000bb';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: '00000000-0000-4000-8000-0000000000cc',
    orderNo: 'MO-20261001-ABCDEF01',
    buyerUserId: BUYER,
    providerId: PROVIDER_ID,
    serviceId: SERVICE_ID,
    childId: null,
    domain: 'TUTORING',
    status: 'PENDING_PAYMENT',
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: new Date(Date.now() + 120 * 60_000),
    scheduledEnd: new Date(Date.now() + 180 * 60_000),
    priceSnapshot: {
      serviceId: SERVICE_ID,
      title: '数学一对一',
      priceMinor: 20_000,
      currency: 'CNY',
      durationMinutes: 60,
    },
    policySnapshot: {
      feeVersion: 'platform-fee-v1',
      feeRateBps: 1_000,
      cancellationPolicyId: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build() {
  const payments = new FakePaymentRepository();
  const gateway = new FakePaymentGateway();
  const orders = new FakeOrderRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const stored = order();
  orders.orders.set(stored.id, stored);

  // Only the methods the payment context uses; the rest is T013's business.
  const orderService = {
    getForParticipant: async (userId: string, orderId: string) => {
      const found = orders.orders.get(orderId);
      if (!found) {
        const { orderNotFound } = await import('../../../src/modules/orders/domain/order.errors');
        throw orderNotFound();
      }
      if (found.buyerUserId !== userId && userId !== PROVIDER_OWNER) {
        const { orderNotFound } = await import('../../../src/modules/orders/domain/order.errors');
        throw orderNotFound();
      }
      return found;
    },
    findByOrderNo: async (orderNo: string) =>
      [...orders.orders.values()].find((candidate) => candidate.orderNo === orderNo) ?? null,
    findById: async (orderId: string) => orders.orders.get(orderId) ?? null,
    markPaid: async (orderId: string) => {
      const found = orders.orders.get(orderId);
      if (!found) {
        const { orderNotFound } = await import('../../../src/modules/orders/domain/order.errors');
        throw orderNotFound();
      }
      // Idempotent, exactly like the real command.
      return found.status === 'PAID' ? found : orders.setStatus(orderId, 'PAID');
    },
  } as unknown as OrderService;

  const verifier = new PassthroughNotificationVerifier({ environment: 'test' });
  const service = new PaymentService(payments, gateway, verifier, orderService, idempotency);
  return { service, payments, gateway, orders, stored };
}

type Context = ReturnType<typeof build>;

/** A notification arrives as raw bytes with headers; the verifier parses them. */
function notify(ctx: Context, payload: unknown) {
  return ctx.service.handleCallback({ headers: {}, body: JSON.stringify(payload) });
}

describe('PaymentService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('opens a session for the amount the order carries', async () => {
    const result = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    expect(result.reused).toBe(false);
    expect(result.amountMinor).toBe(20_000);
    expect(result.payment.status).toBe('INITIATED');
    // The provider was asked for the server's amount, not a client one.
    expect(ctx.gateway.created[0]).toMatchObject({
      orderId: ctx.stored.id,
      orderNo: ctx.stored.orderNo,
      amountMinor: 20_000,
      currency: 'CNY',
    });
  });

  it('refuses to pay an order that is not pending payment', async () => {
    await ctx.orders.setStatus(ctx.stored.id, 'PAID');

    await expect(
      ctx.service.createSession(BUYER, { orderId: ctx.stored.id }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_PAYABLE', status: 409 });
    expect(ctx.gateway.created).toHaveLength(0);
  });

  it('lets only the buyer pay', async () => {
    await expect(
      ctx.service.createSession(PROVIDER_OWNER, { orderId: ctx.stored.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(
      ctx.service.createSession(STRANGER, { orderId: ctx.stored.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reuses an open session and replays an idempotent request', async () => {
    const first = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });
    const second = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    expect(second.reused).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    // One provider transaction, not two.
    expect(ctx.gateway.created).toHaveLength(1);

    const keyed = await ctx.service.createSession(BUYER, {
      orderId: ctx.stored.id,
      idempotencyKey: 'pay-1',
    });
    const replayed = await ctx.service.createSession(BUYER, {
      orderId: ctx.stored.id,
      idempotencyKey: 'pay-1',
    });
    expect(replayed.payment.id).toBe(keyed.payment.id);
  });

  it('marks the order paid once the server confirms the callback', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });
    const transactionId = session.payment.providerTransactionId!;

    const applied = await notify(ctx, {
      orderNo: ctx.stored.orderNo,
      providerTransactionId: transactionId,
      amountMinor: 20_000,
      status: 'SUCCEEDED',
      rawRef: 'stored/callback/1',
    });

    expect(applied).toMatchObject({
      applied: true,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });
    expect(ctx.orders.orders.get(ctx.stored.id)?.status).toBe('PAID');
    expect(ctx.payments.payments.get(session.payment.id)?.paidAt).not.toBeNull();
    expect(ctx.payments.payments.get(session.payment.id)?.rawCallbackRef).toBe('stored/callback/1');
  });

  it('answers a replayed callback without a second transition', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });
    const payload = {
      orderNo: ctx.stored.orderNo,
      providerTransactionId: session.payment.providerTransactionId!,
      amountMinor: 20_000,
      status: 'SUCCEEDED' as const,
    };

    const first = await notify(ctx, payload);
    const replay = await notify(ctx, payload);

    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(replay.orderStatus).toBe('PAID');
    // One payment row, one order transition.
    expect(ctx.payments.payments.size).toBe(1);
  });

  it('rejects a callback whose amount does not match the order', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    await expect(
      notify(ctx, {
        orderNo: ctx.stored.orderNo,
        providerTransactionId: session.payment.providerTransactionId!,
        amountMinor: 1,
        status: 'SUCCEEDED',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID', status: 400 });

    // The order stays unpaid and the payment is not marked succeeded.
    expect(ctx.orders.orders.get(ctx.stored.id)?.status).toBe('PENDING_PAYMENT');
    expect(ctx.payments.payments.get(session.payment.id)?.status).toBe('INITIATED');
  });

  it('rejects a callback for an unknown order or transaction', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    await expect(
      notify(ctx, {
        orderNo: 'MO-NOPE-00000000',
        providerTransactionId: session.payment.providerTransactionId!,
        amountMinor: 20_000,
        status: 'SUCCEEDED',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });

    await expect(
      notify(ctx, {
        orderNo: ctx.stored.orderNo,
        providerTransactionId: 'txn-unknown',
        amountMinor: 20_000,
        status: 'SUCCEEDED',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_CALLBACK_INVALID' });

    // A malformed payload never reaches an order.
    await expect(notify(ctx, { orderNo: ctx.stored.orderNo })).rejects.toMatchObject({
      code: 'PAYMENT_CALLBACK_INVALID',
    });
  });

  it('records a provider failure without paying the order', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    await expect(
      notify(ctx, {
        orderNo: ctx.stored.orderNo,
        providerTransactionId: session.payment.providerTransactionId!,
        amountMinor: 20_000,
        status: 'FAILED',
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_FAILED', status: 402 });

    expect(ctx.payments.payments.get(session.payment.id)?.status).toBe('FAILED');
    expect(ctx.orders.orders.get(ctx.stored.id)?.status).toBe('PENDING_PAYMENT');
  });

  it('confirms through the provider query when the status is read', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });
    ctx.gateway.paidTransactions.set(session.payment.providerTransactionId!, 20_000);

    const status = await ctx.service.getStatus(BUYER, ctx.stored.id);

    expect(status.order.status).toBe('PAID');
    expect(status.payment?.status).toBe('SUCCEEDED');
  });

  it('rejects a provider query that reports another amount', async () => {
    const session = await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });
    ctx.gateway.paidTransactions.set(session.payment.providerTransactionId!, 1);

    await expect(ctx.service.getStatus(BUYER, ctx.stored.id)).rejects.toMatchObject({
      code: 'PAYMENT_CALLBACK_INVALID',
    });
    expect(ctx.orders.orders.get(ctx.stored.id)?.status).toBe('PENDING_PAYMENT');
  });

  it('reports a pending payment without touching the order', async () => {
    await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    const status = await ctx.service.getStatus(BUYER, ctx.stored.id);

    expect(status.order.status).toBe('PENDING_PAYMENT');
    expect(status.payment?.status).toBe('INITIATED');
    expect(status.amountMinor).toBe(20_000);
  });

  it('keeps the payment status between the parties only', async () => {
    await ctx.service.createSession(BUYER, { orderId: ctx.stored.id });

    await expect(ctx.service.getStatus(PROVIDER_OWNER, ctx.stored.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(ctx.service.getStatus(STRANGER, ctx.stored.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
