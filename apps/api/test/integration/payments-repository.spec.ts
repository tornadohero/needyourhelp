import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaPaymentRepository } from '../../src/modules/payments/infrastructure/prisma-payment.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Payment persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §payments,
 * `specs/08-payment-and-settlement.md` §Payment invariants).
 */
describeWithDatabase('payment repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaPaymentRepository;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let orderId: string;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaPaymentRepository(prisma);

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
        orderNo: 'MO-REPO-00000001',
        buyerUserId: buyer.id,
        providerId: provider.id,
        serviceId: service.id,
        domain: 'TUTORING',
        status: 'PENDING_PAYMENT',
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
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newPayment(providerTransactionId: string) {
    return repository.create({
      orderId,
      provider: 'MOCK',
      providerTransactionId,
      amountMinor: 20_000,
      prepayReference: `prepay-${providerTransactionId}`,
    });
  }

  it('creates an initiated payment and finds it three ways', async () => {
    const created = await newPayment('txn-repo-1');

    expect(created.status).toBe('INITIATED');
    expect(created.amountMinor).toBe(20_000);
    expect((await repository.findById(created.id))?.id).toBe(created.id);
    expect((await repository.findByProviderTransactionId('txn-repo-1'))?.id).toBe(created.id);
    expect((await repository.findLatestByOrder(orderId))?.id).toBe(created.id);
    expect(await repository.findByProviderTransactionId('txn-missing')).toBeNull();
  });

  it('lists the attempts of an order, newest first', async () => {
    await newPayment('txn-repo-2');
    // `created_at` has millisecond precision: without a gap the two attempts
    // share a timestamp and "newest" stops being decidable.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await newPayment('txn-repo-3');

    const attempts = await repository.listByOrder(orderId);
    expect(attempts).toHaveLength(3);
    expect(attempts[0]?.providerTransactionId).toBe('txn-repo-3');
  });

  it('marks a payment succeeded once, however often it is replayed', async () => {
    const created = await newPayment('txn-repo-4');
    const paidAt = new Date('2026-10-01T00:00:00.000Z');

    const succeeded = await repository.markSucceeded(created.id, {
      providerTransactionId: 'txn-repo-4',
      amountMinor: 20_000,
      paidAt,
      rawCallbackRef: 'stored/callback/4',
    });
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.paidAt).toEqual(paidAt);
    expect(succeeded.rawCallbackRef).toBe('stored/callback/4');

    // A replay must not change the record nor throw: one transition, one row.
    const replay = await repository.markSucceeded(created.id, {
      providerTransactionId: 'txn-repo-4',
      amountMinor: 20_000,
      paidAt: new Date(),
      rawCallbackRef: 'stored/callback/again',
    });
    expect(replay.paidAt).toEqual(paidAt);
    expect(replay.rawCallbackRef).toBe('stored/callback/4');

    expect(await prisma.payment.count({ where: { orderId } })).toBe(4);
  });

  it('marks other outcomes through an explicit status', async () => {
    const created = await newPayment('txn-repo-5');

    const failed = await repository.markStatus(created.id, 'FAILED');
    expect(failed.status).toBe('FAILED');
    expect((await repository.findById(created.id))?.status).toBe('FAILED');
  });
});
