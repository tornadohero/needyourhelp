import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { PROVIDER_DIRECTORY } from '../../discovery/domain/provider-directory';
import type { ProviderDirectory } from '../../discovery/domain/provider-directory';
import { OrderService } from '../../orders/application/order.service';
import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../platform/domain/feature-flag.repository';
import type { FeatureFlagRepository } from '../../platform/domain/feature-flag.repository';
import { FEATURE_FLAGS } from '../../platform/infrastructure/prisma-feature-flag.repository';
import {
  DEFAULT_REVIEW_PAGE_SIZE,
  assertContent,
  assertOrderReviewable,
  assertPage,
  assertPageSize,
  assertRating,
  nextRatingAverage,
  resolveParties,
} from '../domain/review-policy';
import { REVIEW_REPOSITORY } from '../domain/review.repository';
import type { ReviewRepository } from '../domain/review.repository';
import type { Review } from '../domain/review.model';
import { reviewNotEligible, reviewNotFound } from '../domain/review.errors';

export interface CreateReviewCommand {
  rating: number;
  content?: string | null;
}

export interface ReviewListQuery {
  page?: number;
  pageSize?: number;
}

/**
 * Reviews (`specs/05-api-spec.md` §Reviews, `specs/01-business-rules.md`
 * §Review).
 *
 * Eligibility is the whole of this service:
 * - the order must have reached `COMPLETED` — nothing is reviewable before the
 *   session was delivered, and nothing after a cancellation, refund or dispute;
 * - one review per order and direction — the second attempt is refused before
 *   the write, so the unique index is a backstop;
 * - the provider may review the customer only when the policy switch is on.
 *
 * Completing an order also feeds the two trust signals discovery ranks on: the
 * provider's completed-order count (written by the order command) and their
 * rating (written here, from the reviews themselves).
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(PROVIDER_DIRECTORY) private readonly directory: ProviderDirectory,
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `POST /orders/:id/reviews`. */
  async createReview(
    userId: string,
    orderId: string,
    command: CreateReviewCommand,
  ): Promise<Review> {
    const rating = assertRating(command.rating);
    const content = assertContent(command.content);

    // Only a party of the order gets past this read (`specs/07`).
    const order = await this.orders.getForParticipant(userId, orderId);

    // 1. Review only after completion.
    assertOrderReviewable(order.status);

    const provider = await this.profiles.findById(order.providerId);
    if (!provider) {
      throw reviewNotFound('This provider no longer exists.');
    }

    // 2. Who may review whom, under the current policy.
    const providerReviewEnabled = await this.flags.isEnabled(FEATURE_FLAGS.providerReviewCustomer);
    const parties = resolveParties(
      userId,
      { buyerUserId: order.buyerUserId, providerUserId: provider.userId },
      providerReviewEnabled,
    );

    // 3. One review per order and direction.
    const existing = await this.reviews.findByOrderAndReviewer(
      order.id,
      parties.reviewerUserId,
      parties.revieweeUserId,
    );
    if (existing) {
      throw reviewNotEligible('You have already reviewed this order.');
    }

    const review = await this.reviews.create({
      orderId: order.id,
      reviewerUserId: parties.reviewerUserId,
      revieweeUserId: parties.revieweeUserId,
      rating,
      content,
    });

    // The rating belongs to the provider profile: discovery ranks on it, and it
    // is recomputed from the stored average, never from a client number.
    if (parties.revieweeUserId === provider.userId) {
      await this.applyRating(provider.id, provider.ratingAvg, provider.ratingCount, rating);
    }

    await this.analytics?.track({
      name: 'review_submitted',
      actorUserId: userId,
      providerId: order.providerId,
      orderId: order.id,
      props: { rating },
    });

    return review;
  }

  /** `GET /orders/:id/reviews`: what both parties wrote about this session. */
  async listOrderReviews(
    userId: string,
    orderId: string,
  ): Promise<{
    items: Review[];
    total: number;
  }> {
    const order = await this.orders.getForParticipant(userId, orderId);
    const items = await this.reviews.listByOrder(order.id);
    return { items, total: items.length };
  }

  /**
   * `GET /providers/:id/reviews`: the public page.
   *
   * Only a discoverable provider has a public review page — the same gate as the
   * rest of discovery (T010) — and hidden content never appears.
   */
  async listProviderReviews(
    providerId: string,
    query: ReviewListQuery = {},
  ): Promise<{ items: Review[]; total: number; page: number; pageSize: number }> {
    const page = assertPage(query.page ?? 1);
    const pageSize = assertPageSize(query.pageSize ?? DEFAULT_REVIEW_PAGE_SIZE);

    const detail = await this.directory.findDiscoverable(providerId);
    if (!detail) {
      throw reviewNotFound('Provider not found.');
    }

    const result = await this.reviews.listByReviewee(detail.provider.userId, {
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  private async applyRating(
    providerId: string,
    currentAverage: number | null,
    currentCount: number,
    rating: number,
  ): Promise<void> {
    const next = nextRatingAverage(currentAverage, currentCount, rating);
    await this.profiles.updateRating(providerId, next.ratingAvg, next.ratingCount);
  }
}
