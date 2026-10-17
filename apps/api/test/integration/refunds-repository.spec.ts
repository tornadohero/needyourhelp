import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaRefundRepository } from '../../src/modules/refunds/infrastructure/prisma-refund.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Refund persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §refunds,
 * `specs/08-payment-and-settlement.md` §Refund).
 *
 * The sum is the ceiling that makes "cannot refund more than captured" true even
 * when several refunds exist.
 */
describeWithDatabase('refund repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaRefundRepository;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaRefundRepository(prisma);

    const buyer = await prisma.user.create({ data: { displayName: '家长', status: 'ACTIVE' } });
    const owner = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(buyer.id, owner.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: owner.id,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
      },
    });
    providerIds.push(provider.id);

    const service = await prisma.service.create({
      data: {
        providerId: provider.id,
        domain: 'TUTORING',
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor: 20_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNo: 'MO-REFUND-000001',
        buyerUserId: buyer.id,
        providerId: provider.id,
        serviceId: service.id,
        domain: 'TUTORING',
        status: 'REFUND_PENDING',
        amountMinor: 20_000,
        platformFeeMinor: 2_000,
        providerAmountMinor: 18_000,
        currency: 'CNY',
        priceSnapshot: {
          serviceId: service.id,
          priceMinor: 20_000,
          title: '数学一对一',
          currency: 'CNY',
          durationMinutes: 60,
        },
        policySnapshot: {
          feeVersion: 'platform-fee-v1',
          feeRateBps: 1_000,
          cancellationPolicyId: null,
        },
      },
    });
    orderId = order.id;

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'MOCK',
        providerTransactionId: 'txn-refund-repo-1',
        status: 'SUCCEEDED',
        amountMinor: 20_000,
        paidAt: new Date(),
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await prisma.refund.deleteMany({ where: { orderId } });
    await prisma.payment.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('creates a requested refund and reads it back', async () => {
    const created = await repository.create({
      orderId,
      paymentId,
      amountMinor: 5_000,
      reason: '家长要求',
    });

    expect(created.status).toBe('REQUESTED');
    expect(created.amountMinor).toBe(5_000);
    expect((await repository.findById(created.id))?.id).toBe(created.id);
    expect(await repository.findById('22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(await repository.listByOrder(orderId)).toHaveLength(1);
  });

  it('records the gateway outcome and the provider reference', async () => {
    const created = await repository.create({
      orderId,
      paymentId,
      amountMinor: 5_000,
      reason: null,
    });

    const succeeded = await repository.markStatus(created.id, 'SUCCEEDED', 'provider-ref-1');
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.providerRef).toBe('provider-ref-1');
    expect((await repository.findById(created.id))?.status).toBe('SUCCEEDED');
  });

  it('sums only the money that moved back', async () => {
    // Measured against the rows the earlier cases already wrote.
    const before = await repository.sumRefundedByOrder(orderId);
    const beforeCount = (await repository.listByOrder(orderId)).length;

    const succeeded = await repository.create({
      orderId,
      paymentId,
      amountMinor: 5_000,
      reason: null,
    });
    await repository.markStatus(succeeded.id, 'SUCCEEDED', 'provider-ref-2');

    const processing = await repository.create({
      orderId,
      paymentId,
      amountMinor: 2_000,
      reason: null,
    });
    await repository.markStatus(processing.id, 'PROCESSING');

    // A failed attempt returned nothing, so it must not reduce the ceiling.
    const failed = await repository.create({
      orderId,
      paymentId,
      amountMinor: 9_000,
      reason: null,
    });
    await repository.markStatus(failed.id, 'FAILED');

    expect(await repository.sumRefundedByOrder(orderId)).toBe(before + 7_000);
    // Every refund of the order shows up in the list, whatever its outcome.
    expect(await repository.listByOrder(orderId)).toHaveLength(beforeCount + 3);
  });
});
