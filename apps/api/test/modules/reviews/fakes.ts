import type { CreateReviewInput, Review } from '../../../src/modules/reviews/domain/review.model';
import type { ReviewRepository } from '../../../src/modules/reviews/domain/review.repository';
import { PUBLIC_REVIEW_STATUSES } from '../../../src/modules/reviews/domain/review-policy';
import type {
  FeatureFlag,
  FeatureFlagRepository,
} from '../../../src/modules/platform/domain/feature-flag.repository';

/** In-memory {@link ReviewRepository}. */
export class FakeReviewRepository implements ReviewRepository {
  readonly reviews = new Map<string, Review>();
  /** The unique triplet, mirroring `reviews`' own constraint. */
  readonly index = new Map<string, string>();
  private sequence = 0;

  async create(input: CreateReviewInput): Promise<Review> {
    this.sequence += 1;
    const now = new Date();
    const review: Review = {
      id: `00000000-0000-4000-a000-${String(this.sequence).padStart(12, '0')}`,
      orderId: input.orderId,
      reviewerUserId: input.reviewerUserId,
      revieweeUserId: input.revieweeUserId,
      rating: input.rating,
      content: input.content,
      status: 'PUBLISHED',
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.set(review.id, review);
    this.index.set(key(input.orderId, input.reviewerUserId, input.revieweeUserId), review.id);
    return review;
  }

  async findById(id: string): Promise<Review | null> {
    return this.reviews.get(id) ?? null;
  }

  async findByOrderAndReviewer(
    orderId: string,
    reviewerUserId: string,
    revieweeUserId: string,
  ): Promise<Review | null> {
    const id = this.index.get(key(orderId, reviewerUserId, revieweeUserId));
    return id ? (this.reviews.get(id) ?? null) : null;
  }

  async listByOrder(orderId: string): Promise<Review[]> {
    return [...this.reviews.values()]
      .filter((review) => review.orderId === orderId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listByReviewee(
    revieweeUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: Review[]; total: number }> {
    const matching = [...this.reviews.values()]
      .filter(
        (review) =>
          review.revieweeUserId === revieweeUserId &&
          PUBLIC_REVIEW_STATUSES.includes(review.status),
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return {
      items: matching.slice(options.skip, options.skip + options.take),
      total: matching.length,
    };
  }

  /** Moderation hides content without deleting the row (T018). */
  async setStatus(id: string, status: Review['status']): Promise<Review> {
    const current = this.reviews.get(id);
    if (!current) {
      throw new Error(`unknown review ${id}`);
    }
    const updated: Review = { ...current, status, updatedAt: new Date() };
    this.reviews.set(id, updated);
    return updated;
  }

  /** Test seam: moderation hides content without deleting the row. */
  async hide(id: string): Promise<Review> {
    return this.setStatus(id, 'HIDDEN');
  }
}

function key(orderId: string, reviewerUserId: string, revieweeUserId: string): string {
  return `${orderId}:${reviewerUserId}:${revieweeUserId}`;
}

/** Feature flags as the review context sees them: one switch, explicitly set. */
export class FakeFeatureFlagRepository implements FeatureFlagRepository {
  readonly enabled: Record<string, boolean>;

  constructor(enabled: Record<string, boolean> = {}) {
    this.enabled = { ...enabled };
  }

  async isEnabled(flagKey: string): Promise<boolean> {
    return this.enabled[flagKey] ?? false;
  }

  async list(): Promise<FeatureFlag[]> {
    return Object.entries(this.enabled).map(([key, enabled]) => ({
      key,
      enabled,
      configJson: {},
      updatedAt: new Date(),
    }));
  }

  async setEnabled(key: string, enabled: boolean): Promise<FeatureFlag> {
    this.enabled[key] = enabled;
    return { key, enabled, configJson: {}, updatedAt: new Date() };
  }
}
