import { beforeEach, describe, expect, it } from 'vitest';

import type { ProviderDirectory } from '../../../src/modules/discovery/domain/provider-directory';
import type { ProviderDetail } from '../../../src/modules/discovery/domain/provider-search.model';
import type { Order } from '../../../src/modules/orders/domain/order.model';
import type { OrderService } from '../../../src/modules/orders/application/order.service';
import { orderNotFound } from '../../../src/modules/orders/domain/order.errors';
import type { ProviderProfile } from '../../../src/modules/provider/domain/provider-profile.model';
import { ReviewService } from '../../../src/modules/reviews/application/review.service';
import { FakeFeatureFlagRepository, FakeReviewRepository } from './fakes';
import { FakeProviderProfileRepository } from '../provider/fakes';

const BUYER = '11111111-1111-4111-8111-111111111111';
const PROVIDER_USER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const ORDER_ID = '00000000-0000-4000-8000-0000000000cc';

function order(status: Order['status'] = 'COMPLETED'): Order {
  return {
    id: ORDER_ID,
    orderNo: 'MO-20261001-ABCDEF01',
    buyerUserId: BUYER,
    providerId: PROVIDER_ID,
    serviceId: '00000000-0000-4000-8000-0000000000bb',
    childId: null,
    domain: 'TUTORING',
    status,
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: new Date(Date.now() - 120 * 60_000),
    scheduledEnd: new Date(Date.now() - 60 * 60_000),
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
  };
}

interface BuildOptions {
  status?: Order['status'];
  providerReviewCustomer?: boolean;
  discoverable?: boolean;
  ratingAvg?: number | null;
  ratingCount?: number;
}

function build(options: BuildOptions = {}) {
  const reviews = new FakeReviewRepository();
  const profiles = new FakeProviderProfileRepository();
  const flags = new FakeFeatureFlagRepository({
    provider_review_customer_enabled: options.providerReviewCustomer ?? false,
  });

  const profile: ProviderProfile = {
    id: PROVIDER_ID,
    userId: PROVIDER_USER,
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: null,
    bio: null,
    avatarVisibility: 'PRIVATE',
    avatarAssetId: null,
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    approvalStatus: 'APPROVED',
    searchable: true,
    ratingAvg: options.ratingAvg ?? null,
    ratingCount: options.ratingCount ?? 0,
    completedOrderCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  void profiles.profiles.set(PROVIDER_ID, profile);

  const currentOrder = order(options.status ?? 'COMPLETED');
  const discoverable = options.discoverable ?? true;

  const orderService = {
    getForParticipant: async (userId: string, id: string) => {
      if (id !== currentOrder.id) {
        throw orderNotFound();
      }
      // Mirrors the order context: only the two parties may read the order.
      if (userId !== BUYER && userId !== PROVIDER_USER) {
        throw orderNotFound();
      }
      return currentOrder;
    },
  } as unknown as OrderService;

  const directory = {
    findDiscoverable: async (): Promise<ProviderDetail | null> =>
      discoverable ? { provider: profile, capabilities: [], services: [] } : null,
  } as unknown as ProviderDirectory;

  const service = new ReviewService(reviews, orderService, profiles, directory, flags);

  return { service, reviews, profiles, currentOrder, profile };
}

type Context = ReturnType<typeof build>;

describe('ReviewService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('lets the customer review a completed order, and rolls the rating', async () => {
    const review = await ctx.service.createReview(BUYER, ORDER_ID, {
      rating: 5,
      content: '讲得很清楚',
    });

    expect(review).toMatchObject({
      orderId: ORDER_ID,
      reviewerUserId: BUYER,
      revieweeUserId: PROVIDER_USER,
      rating: 5,
      content: '讲得很清楚',
      status: 'PUBLISHED',
    });

    // The rating is the provider's, recomputed from the stored average.
    const updated = await ctx.profiles.findById(PROVIDER_ID);
    expect(updated).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
  });

  it('refuses a review before the order completed', async () => {
    for (const status of ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'IN_PROGRESS'] as const) {
      const pending = build({ status });
      await expect(
        pending.service.createReview(BUYER, ORDER_ID, { rating: 5 }),
        status,
      ).rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE', status: 409 });
    }

    // Terminal states that returned money or never delivered are not reviewable.
    for (const status of ['CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'DISPUTED'] as const) {
      const closed = build({ status });
      await expect(
        closed.service.createReview(BUYER, ORDER_ID, { rating: 5 }),
        status,
      ).rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE' });
    }

    expect(ctx.reviews.reviews.size).toBe(0);
  });

  it('allows one review per order and direction', async () => {
    await ctx.service.createReview(BUYER, ORDER_ID, { rating: 5 });

    await expect(ctx.service.createReview(BUYER, ORDER_ID, { rating: 1 })).rejects.toMatchObject({
      code: 'REVIEW_NOT_ELIGIBLE',
      status: 409,
    });

    expect(ctx.reviews.reviews.size).toBe(1);
    expect((await ctx.profiles.findById(PROVIDER_ID))?.ratingCount).toBe(1);
  });

  it('lets the provider review the customer only when policy enables it', async () => {
    await expect(
      ctx.service.createReview(PROVIDER_USER, ORDER_ID, { rating: 4 }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE' });
    expect(ctx.reviews.reviews.size).toBe(0);

    const enabled = build({ providerReviewCustomer: true });
    const review = await enabled.service.createReview(PROVIDER_USER, ORDER_ID, { rating: 4 });
    expect(review).toMatchObject({
      reviewerUserId: PROVIDER_USER,
      revieweeUserId: BUYER,
    });
    // A customer is not a provider profile: no rating column to roll.
    expect((await enabled.profiles.findById(PROVIDER_ID))?.ratingCount).toBe(0);
  });

  it('keeps a stranger out', async () => {
    await expect(ctx.service.createReview(STRANGER, ORDER_ID, { rating: 5 })).rejects.toMatchObject(
      { code: 'NOT_FOUND', status: 404 },
    );
  });

  it('validates the rating and the text', async () => {
    for (const rating of [0, 6, 2.5]) {
      await expect(
        ctx.service.createReview(BUYER, ORDER_ID, { rating }),
        String(rating),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
    await expect(
      ctx.service.createReview(BUYER, ORDER_ID, { rating: 5, content: 'x'.repeat(1001) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ctx.reviews.reviews.size).toBe(0);
  });

  it('rolls the average over several reviews', async () => {
    const second = build({ ratingAvg: 5, ratingCount: 1 });
    await second.service.createReview(BUYER, ORDER_ID, { rating: 4 });
    expect(await second.profiles.findById(PROVIDER_ID)).toMatchObject({
      ratingAvg: 4.5,
      ratingCount: 2,
    });
  });

  it('lists what both parties wrote about the order', async () => {
    await ctx.service.createReview(BUYER, ORDER_ID, { rating: 5 });
    const enabled = build({ providerReviewCustomer: true });
    await enabled.service.createReview(PROVIDER_USER, ORDER_ID, { rating: 4 });

    const byBuyer = await ctx.service.listOrderReviews(BUYER, ORDER_ID);
    expect(byBuyer.total).toBe(1);

    const both = await enabled.service.listOrderReviews(PROVIDER_USER, ORDER_ID);
    expect(both.total).toBe(1);

    await expect(ctx.service.listOrderReviews(STRANGER, ORDER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('shows only a discoverable provider, and only published content', async () => {
    await ctx.service.createReview(BUYER, ORDER_ID, { rating: 5, content: '很好' });

    const page = await ctx.service.listProviderReviews(PROVIDER_ID, { page: 1, pageSize: 1 });
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(page.items[0]?.content).toBe('很好');

    // Moderation hides the text, it does not delete the row.
    const hidden = [...ctx.reviews.reviews.values()][0]!;
    await ctx.reviews.hide(hidden.id);
    expect((await ctx.service.listProviderReviews(PROVIDER_ID)).total).toBe(0);

    // A provider who is not discoverable has no public review page.
    const unknown = build({ discoverable: false });
    await expect(unknown.service.listProviderReviews(PROVIDER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
