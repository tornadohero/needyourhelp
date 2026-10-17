import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaOrderRepository } from '../../src/modules/orders/infrastructure/prisma-order.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Order persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §orders, `specs/08-payment-and-settlement.md`
 * §Money model).
 */
describeWithDatabase('order repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaOrderRepository;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let buyer: string;
  let providerId: string;
  let serviceId: string;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaOrderRepository(prisma);

    const buyerUser = await prisma.user.create({ data: { displayName: '家长', status: 'ACTIVE' } });
    const owner = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(buyerUser.id, owner.id);
    buyer = buyerUser.id;

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
    providerId = provider.id;

    const service = await prisma.service.create({
      data: {
        providerId,
        domain: 'TUTORING',
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor: 20_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });
    serviceId = service.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { buyerUserId: { in: userIds } } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  function newOrder(orderNo: string, overrides: { buyerUserId?: string } = {}) {
    return repository.create({
      orderNo,
      buyerUserId: overrides.buyerUserId ?? buyer,
      providerId,
      serviceId,
      childId: null,
      domain: 'TUTORING',
      scheduledStart: new Date(Date.now() + 120 * 60_000),
      scheduledEnd: new Date(Date.now() + 180 * 60_000),
      amountMinor: 20_000,
      platformFeeMinor: 2_000,
      providerAmountMinor: 18_000,
      currency: 'CNY',
      priceSnapshot: {
        serviceId,
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
    });
  }

  it('creates an unpaid order and reads it back by id and number', async () => {
    const orderNo = `MO-TEST-${randomUUID().slice(0, 8)}`;
    const created = await newOrder(orderNo);

    expect(created.status).toBe('PENDING_PAYMENT');
    expect(created.amountMinor).toBe(20_000);
    expect(created.platformFeeMinor).toBe(2_000);
    expect(created.providerAmountMinor).toBe(18_000);

    expect((await repository.findById(created.id))?.orderNo).toBe(orderNo);
    expect((await repository.findByOrderNo(orderNo))?.id).toBe(created.id);
    expect(await repository.findById(randomUUID())).toBeNull();
  });

  it('keeps the snapshots as jsonb', async () => {
    const created = await newOrder(`MO-TEST-${randomUUID().slice(0, 8)}`);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.priceSnapshot).toMatchObject({ priceMinor: 20_000, title: '数学一对一' });
    expect(row.policySnapshot).toMatchObject({ feeVersion: 'platform-fee-v1' });

    // The round trip keeps the shape: an order never re-reads a live price.
    expect(created.priceSnapshot.priceMinor).toBe(20_000);
    expect(created.policySnapshot.feeRateBps).toBe(1_000);
  });

  it('lists the orders of a participant, newest first and paged', async () => {
    const first = await newOrder(`MO-TEST-${randomUUID().slice(0, 8)}`);
    await newOrder(`MO-TEST-${randomUUID().slice(0, 8)}`);
    await newOrder(`MO-TEST-${randomUUID().slice(0, 8)}`, {
      buyerUserId: userIds[1] ?? buyer,
    });

    const page = await repository.listForParticipant({
      userId: buyer,
      providerIds: [],
      page: 1,
      pageSize: 2,
    });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(2);

    // As the provider, the orders of the profile count too.
    const asProvider = await repository.listForParticipant({
      userId: '77777777-7777-4777-8777-777777777777',
      providerIds: [providerId],
      page: 1,
      pageSize: 50,
    });
    expect(asProvider.items.map((order) => order.id)).toContain(first.id);

    // Neither buyer nor provider: nothing.
    const stranger = await repository.listForParticipant({
      userId: '88888888-8888-4888-8888-888888888888',
      providerIds: [],
      page: 1,
      pageSize: 50,
    });
    expect(stranger.total).toBe(0);
  });

  it('changes the status only through a command', async () => {
    const created = await newOrder(`MO-TEST-${randomUUID().slice(0, 8)}`);

    const paid = await repository.setStatus(created.id, 'PAID');
    expect(paid.status).toBe('PAID');
    expect((await repository.findById(created.id))?.status).toBe('PAID');

    const completed = await repository.setStatus(created.id, 'COMPLETED');
    expect(completed.status).toBe('COMPLETED');
  });
});
