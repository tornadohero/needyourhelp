import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaReviewRepository } from '../../src/modules/reviews/infrastructure/prisma-review.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Review persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §reviews).
 *
 * The unique `(order_id, reviewer_user_id, reviewee_user_id)` is the backstop of
 * "one review per order and direction", and the public read is the one that must
 * never show hidden content.
 */
describeWithDatabase('review repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaReviewRepository;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let orderId: string;
  let buyerId: string;
  let providerUserId: string;
  let otherBuyerId: string;
  let thirdBuyerId: string;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaReviewRepository(prisma);

    const buyer = await prisma.user.create({ data: { displayName: '家长', status: 'ACTIVE' } });
    const otherBuyer = await prisma.user.create({
      data: { displayName: '另一位家长', status: 'ACTIVE' },
    });
    const thirdBuyer = await prisma.user.create({
      data: { displayName: '第三位家长', status: 'ACTIVE' },
    });
    const owner = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(buyer.id, otherBuyer.id, thirdBuyer.id, owner.id);
    buyerId = buyer.id;
    otherBuyerId = otherBuyer.id;
    thirdBuyerId = thirdBuyer.id;
    providerUserId = owner.id;

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
        orderNo: 'MO-REVIEW-000001',
        buyerUserId: buyer.id,
        providerId: provider.id,
        serviceId: service.id,
        domain: 'TUTORING',
        status: 'COMPLETED',
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
    await prisma.review.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('creates a published review and finds it by the unique triplet', async () => {
    const created = await repository.create({
      orderId,
      reviewerUserId: buyerId,
      revieweeUserId: providerUserId,
      rating: 5,
      content: '讲得很清楚',
    });

    expect(created.status).toBe('PUBLISHED');
    expect((await repository.findById(created.id))?.rating).toBe(5);

    // The guard behind "one review per order and direction".
    const same = await repository.findByOrderAndReviewer(orderId, buyerId, providerUserId);
    expect(same?.id).toBe(created.id);
    // The other direction is a different row, not a duplicate.
    expect(await repository.findByOrderAndReviewer(orderId, providerUserId, buyerId)).toBeNull();
    expect(await repository.listByOrder(orderId)).toHaveLength(1);
  });

  it('pages the public reviews of a provider and hides hidden content', async () => {
    const visible = await repository.create({
      orderId,
      reviewerUserId: otherBuyerId,
      revieweeUserId: providerUserId,
      rating: 4,
      content: '不错',
    });
    const hidden = await repository.create({
      orderId,
      reviewerUserId: thirdBuyerId,
      revieweeUserId: providerUserId,
      rating: 2,
      content: '临时内容',
    });
    await prisma.review.update({ where: { id: hidden.id }, data: { status: 'HIDDEN' } });

    // Newest first: the hidden row is out of the count and out of the page, but
    // the two published ones both remain.
    const firstPage = await repository.listByReviewee(providerUserId, { skip: 0, take: 1 });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items[0]?.id).toBe(visible.id);

    const secondPage = await repository.listByReviewee(providerUserId, { skip: 1, take: 1 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.reviewerUserId).toBe(buyerId);

    // Hidden does not mean deleted: the row is still there for moderation.
    expect((await repository.findById(hidden.id))?.status).toBe('HIDDEN');
  });
});
