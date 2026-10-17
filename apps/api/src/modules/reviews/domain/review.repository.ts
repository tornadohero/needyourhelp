import type { CreateReviewInput, Review, ReviewStatus } from './review.model';

/** Dependency-injection token for {@link ReviewRepository}. */
export const REVIEW_REPOSITORY = 'REVIEW_REPOSITORY';

export interface ReviewRepository {
  create(input: CreateReviewInput): Promise<Review>;

  findById(id: string): Promise<Review | null>;

  /**
   * The guard behind "one review per order and direction": the pair is unique in
   * `reviews`, and this is the read that refuses the second write.
   */
  findByOrderAndReviewer(
    orderId: string,
    reviewerUserId: string,
    revieweeUserId: string,
  ): Promise<Review | null>;

  listByOrder(orderId: string): Promise<Review[]>;

  /** Newest first, bounded: what a public profile shows. */
  listByReviewee(
    revieweeUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: Review[]; total: number }>;

  /**
   * Moderation hides content without deleting the row
   * (`specs/01-business-rules.md` §Review); only the moderation context (T018)
   * calls this, as the result of an audited decision.
   */
  setStatus(id: string, status: ReviewStatus): Promise<Review>;
}
