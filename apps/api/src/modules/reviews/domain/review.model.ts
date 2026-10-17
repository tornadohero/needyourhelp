/**
 * Domain view of `reviews` (`specs/04-database-spec.md` §reviews,
 * `specs/01-business-rules.md` §Review).
 *
 * A review is a judgement of one delivered session by one of its two parties,
 * written at most once per order and direction.
 */

export type ReviewStatus = 'PUBLISHED' | 'HIDDEN';

/**
 * Who reviewed whom.
 *
 * The customer direction is the default one; the provider direction exists only
 * when platform policy enables it.
 */
export type ReviewDirection = 'CUSTOMER_TO_PROVIDER' | 'PROVIDER_TO_CUSTOMER';

export interface Review {
  id: string;
  orderId: string;
  reviewerUserId: string;
  revieweeUserId: string;
  rating: number;
  content: string | null;
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewInput {
  orderId: string;
  reviewerUserId: string;
  revieweeUserId: string;
  rating: number;
  content: string | null;
}

/** The counterparties of a review, as the order sees them. */
export interface ReviewParties {
  direction: ReviewDirection;
  reviewerUserId: string;
  revieweeUserId: string;
}
