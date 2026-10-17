import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryIdempotencyStore } from '../../../src/common/idempotency/in-memory-idempotency.store';
import { IdempotencyConflictError } from '../../../src/common/idempotency/idempotency.store';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/audit-log.repository';
import { AUDIT_ACTIONS } from '../../../src/modules/audit/domain/audit-log.model';
import type { Order } from '../../../src/modules/orders/domain/order.model';
import type { OrderService } from '../../../src/modules/orders/application/order.service';
import type { PaymentRepository } from '../../../src/modules/payments/domain/payment.repository';
import type { Payment } from '../../../src/modules/payments/domain/payment.model';
import { RefundService } from '../../../src/modules/refunds/application/refund.service';
import { FakeRefundGateway, FakeRefundRepository } from './fakes';

const BUYER = '11111111-1111-4111-8111-111111111111';
const PROVIDER_OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const ORDER_ID = '00000000-0000-4000-8000-0000000000cc';

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNo: 'MO-20261001-ABCDEF01',
    buyerUserId: BUYER,
    providerId: PROVIDER_ID,
    serviceId: '00000000-0000-4000-8000-0000000000bb',
    childId: null,
    domain: 'TUTORING',
    status: 'PAID',
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: new Date(Date.now() + 120 * 60_000),
    scheduledEnd: new Date(Date.now() + 180 * 60_000),
    priceSnapshot: {
      serviceId: '00000000-0000-4000-8000-0000000000bb',
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

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '00000000-0000-4000-8000-0000000000dd',
    orderId: ORDER_ID,
    provider: 'MOCK',
    providerTransactionId: 'txn-1',
    status: 'SUCCEEDED',
    amountMinor: 20_000,
    prepayReference: 'prepay-1',
    paidAt: new Date(),
    rawCallbackRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface BuildOptions {
  orderStatus?: Order['status'];
  paymentStatus?: Payment['status'];
  capturedMinor?: number;
}

function build(options: BuildOptions = {}) {
  const refunds = new FakeRefundRepository();
  const gateway = new FakeRefundGateway();
  const idempotency = new InMemoryIdempotencyStore();
  const audits: { action: string; before: unknown; after: unknown }[] = [];

  const audit = {
    record: async (input: { action: string; beforeJson?: unknown; afterJson?: unknown }) => {
      audits.push({ action: input.action, before: input.beforeJson, after: input.afterJson });
    },
  } as unknown as AuditLogRepository;

  const currentOrder = order({ status: options.orderStatus ?? 'PAID' });
  const currentPayment = payment({
    status: options.paymentStatus ?? 'SUCCEEDED',
    amountMinor: options.capturedMinor ?? 20_000,
  });

  const orderService = {
    findById: async (orderId: string) => (orderId === currentOrder.id ? currentOrder : null),
    getForParticipant: async (userId: string, orderId: string) => {
      if (orderId !== currentOrder.id) {
        const { orderNotFound } = await import('../../../src/modules/orders/domain/order.errors');
        throw orderNotFound();
      }
      if (currentOrder.buyerUserId !== userId && userId !== PROVIDER_OWNER) {
        const { orderNotFound } = await import('../../../src/modules/orders/domain/order.errors');
        throw orderNotFound();
      }
      return currentOrder;
    },
    beginRefund: async () => {
      currentOrder.status = 'REFUND_PENDING';
      return currentOrder;
    },
    completeRefund: async () => {
      currentOrder.status = 'REFUNDED';
      return currentOrder;
    },
  } as unknown as OrderService;

  const payments = {
    findLatestByOrder: async () => currentPayment,
  } as unknown as PaymentRepository;

  const service = new RefundService(refunds, payments, gateway, orderService, audit, idempotency);

  return { service, refunds, gateway, audits, currentOrder, currentPayment };
}

type Context = ReturnType<typeof build>;

const CONTEXT = { actorUserId: 'admin-1', requestId: 'req-1', ipHash: null };

describe('RefundService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('puts a paid order into the refund branch when the buyer asks', async () => {
    const result = await ctx.service.requestRefund(BUYER, ORDER_ID, { reason: '时间不合适' });

    expect(result).toEqual({
      orderId: ORDER_ID,
      orderStatus: 'REFUND_PENDING',
      refundableMinor: 20_000,
    });
    // Asking costs no money: no refund row, no gateway call.
    expect(ctx.refunds.refunds.size).toBe(0);
    expect(ctx.gateway.refunds).toHaveLength(0);
  });

  it('refuses a request for an unpaid or finished order', async () => {
    const pending = build({ orderStatus: 'PENDING_PAYMENT', paymentStatus: 'INITIATED' });
    await expect(pending.service.requestRefund(BUYER, ORDER_ID)).rejects.toMatchObject({
      code: 'REFUND_NOT_ALLOWED',
      status: 409,
    });

    const completed = build({ orderStatus: 'COMPLETED' });
    await expect(completed.service.requestRefund(BUYER, ORDER_ID)).rejects.toMatchObject({
      code: 'REFUND_NOT_ALLOWED',
    });
  });

  it('lets only the buyer request a refund', async () => {
    await expect(ctx.service.requestRefund(PROVIDER_OWNER, ORDER_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(ctx.service.requestRefund(STRANGER, ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refunds everything still refundable when no amount is given', async () => {
    const refund = await ctx.service.executeRefund(CONTEXT, ORDER_ID, { reason: '家长要求' });

    expect(refund).toMatchObject({ amountMinor: 20_000, status: 'SUCCEEDED', reason: '家长要求' });
    expect(ctx.gateway.refunds[0]).toMatchObject({
      providerTransactionId: 'txn-1',
      amountMinor: 20_000,
      reason: '家长要求',
    });
    expect(ctx.currentOrder.status).toBe('REFUNDED');
  });

  it('cannot refund more than was captured', async () => {
    await expect(
      ctx.service.executeRefund(CONTEXT, ORDER_ID, { amountMinor: 20_001 }),
    ).rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED', status: 409 });

    // A second full refund after the first is refused as well.
    await ctx.service.executeRefund(CONTEXT, ORDER_ID);
    await expect(ctx.service.executeRefund(CONTEXT, ORDER_ID)).rejects.toMatchObject({
      code: 'REFUND_NOT_ALLOWED',
    });

    // Nothing extra reached the gateway, and only one refund row exists.
    expect(ctx.gateway.refunds).toHaveLength(1);
    expect(ctx.refunds.refunds.size).toBe(1);
  });

  it('stays in the refund branch for a partial refund', async () => {
    const refund = await ctx.service.executeRefund(CONTEXT, ORDER_ID, { amountMinor: 5_000 });

    expect(refund.amountMinor).toBe(5_000);
    // Not fully returned: the order waits, so the rest can still be refunded.
    expect(ctx.currentOrder.status).toBe('REFUND_PENDING');

    const remainder = await ctx.service.executeRefund(CONTEXT, ORDER_ID, { amountMinor: 15_000 });
    expect(remainder.amountMinor).toBe(15_000);
    expect(ctx.currentOrder.status).toBe('REFUNDED');
  });

  it('records a provider failure and leaves the order in the refund branch', async () => {
    ctx.gateway.nextRefundStatus = 'FAILED';

    const refund = await ctx.service.executeRefund(CONTEXT, ORDER_ID);

    expect(refund.status).toBe('FAILED');
    // A failed attempt did not return money, so the ceiling is untouched.
    expect(ctx.currentOrder.status).toBe('REFUND_PENDING');

    ctx.gateway.nextRefundStatus = 'SUCCEEDED';
    const retry = await ctx.service.executeRefund(CONTEXT, ORDER_ID);
    expect(retry.amountMinor).toBe(20_000);
    expect(ctx.currentOrder.status).toBe('REFUNDED');
  });

  it('keeps the order waiting while the provider is still processing', async () => {
    ctx.gateway.nextRefundStatus = 'PROCESSING';

    const refund = await ctx.service.executeRefund(CONTEXT, ORDER_ID);

    expect(refund.status).toBe('PROCESSING');
    expect(ctx.currentOrder.status).toBe('REFUND_PENDING');
  });

  it('is idempotent for both commands', async () => {
    const first = await ctx.service.executeRefund(CONTEXT, ORDER_ID, {
      amountMinor: 5_000,
      idempotencyKey: 'refund-1',
    });
    const replay = await ctx.service.executeRefund(CONTEXT, ORDER_ID, {
      amountMinor: 5_000,
      idempotencyKey: 'refund-1',
    });

    expect(replay.id).toBe(first.id);
    // One gateway call, one refund row: the replay moved no extra money.
    expect(ctx.gateway.refunds).toHaveLength(1);
    expect(ctx.refunds.refunds.size).toBe(1);

    const request = await ctx.service.requestRefund(BUYER, ORDER_ID, {
      idempotencyKey: 'request-1',
    });
    const requestReplay = await ctx.service.requestRefund(BUYER, ORDER_ID, {
      idempotencyKey: 'request-1',
    });
    expect(requestReplay.orderStatus).toBe(request.orderStatus);

    await expect(
      ctx.service.executeRefund(CONTEXT, ORDER_ID, {
        amountMinor: 6_000,
        idempotencyKey: 'refund-1',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('audits every executed refund with before and after', async () => {
    await ctx.service.executeRefund(CONTEXT, ORDER_ID, { amountMinor: 5_000, reason: '部分退款' });

    expect(ctx.audits).toHaveLength(1);
    expect(ctx.audits[0]?.action).toBe(AUDIT_ACTIONS.refundInitiated);
    expect(ctx.audits[0]?.before).toMatchObject({ capturedMinor: 20_000, refundedMinor: 0 });
    expect(ctx.audits[0]?.after).toMatchObject({
      amountMinor: 5_000,
      refundStatus: 'SUCCEEDED',
      refundedMinor: 5_000,
      reason: '部分退款',
    });
  });

  it('lists refunds for the parties of the order only', async () => {
    await ctx.service.executeRefund(CONTEXT, ORDER_ID, { amountMinor: 5_000 });

    expect((await ctx.service.listRefunds(BUYER, ORDER_ID)).total).toBe(1);
    expect((await ctx.service.listRefunds(PROVIDER_OWNER, ORDER_ID)).total).toBe(1);
    await expect(ctx.service.listRefunds(STRANGER, ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
