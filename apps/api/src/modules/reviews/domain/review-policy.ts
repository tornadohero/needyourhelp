import type { OrderStatus } from '../../orders/domain/order.model';
import type { ReviewDirection, ReviewParties, ReviewStatus } from './review.model';
import { reviewInvalidRequest, reviewNotEligible } from './review.errors';

/**
 * Review eligibility (`specs/01-business-rules.md` §Review,
 * `specs/06-verification-state-machine.md` §Order).
 *
 * The two rules that make a review trustworthy are decided here and nowhere
 * else:
 * - **only after the order completed**: nothing may be reviewed while the
 *   session is still pending, in progress, cancelled or in a money dispute;
 * - **one review per order and direction**: enforced before the write, so the
 *   unique index is a backstop, not the only guard.
 */

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

export const MAX_REVIEW_CONTENT_LENGTH = 1_000;

/** The only order state that unlocks reviews. */
export const REVIEWABLE_ORDER_STATUS: OrderStatus = 'COMPLETED';

/**
 * Reviews visible to the public.
 *
 * `HIDDEN` rows stay in the database: moderation hides content, it does not
 * delete the trail (`specs/01-business-rules.md` §Review).
 */
export const PUBLIC_REVIEW_STATUSES: readonly ReviewStatus[] = ['PUBLISHED'];

/**
 * `specs/01-business-rules.md` §Review: "Provider can review customer only if
 * enabled by policy." No spec names the switch, so it lives with the other
 * feature flags and defaults to disabled.
 */
export const PROVIDER_REVIEW_CUSTOMER_FLAG = 'provider_review_customer_enabled';

export const DEFAULT_REVIEW_PAGE_SIZE = 20;
export const MAX_REVIEW_PAGE_SIZE = 50;

/** A review may only be written once the order reached `COMPLETED`. */
export function assertOrderReviewable(status: OrderStatus): void {
  if (status !== REVIEWABLE_ORDER_STATUS) {
    throw reviewNotEligible(`An order in status ${status} cannot be reviewed.`);
  }
}

export function assertRating(rating: number): number {
  if (!Number.isInteger(rating) || rating < REVIEW_RATING_MIN || rating > REVIEW_RATING_MAX) {
    throw reviewInvalidRequest(
      `A rating must be a whole number between ${REVIEW_RATING_MIN} and ${REVIEW_RATING_MAX}.`,
    );
  }
  return rating;
}

/**
 * Review content is free text, so it is the one place where a child could be
 * named. The rule of `specs/10-privacy-and-minors.md` §Child profile rules
 * ("no public child profile") is enforced by bounding what can be published and
 * by never attaching child data: the response carries the order, the rating and
 * the text, never the child profile.
 */
export function assertContent(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const content = value.trim();
  if (content.length === 0) {
    return null;
  }
  if (content.length > MAX_REVIEW_CONTENT_LENGTH) {
    throw reviewInvalidRequest(`A review must be at most ${MAX_REVIEW_CONTENT_LENGTH} characters.`);
  }
  return content;
}

/**
 * Which direction this reviewer is allowed to write.
 *
 * `providerReviewEnabled` is the policy switch of `specs/01`; when it is off the
 * provider can never review the customer.
 */
export function resolveParties(
  reviewerUserId: string,
  order: { buyerUserId: string; providerUserId: string },
  providerReviewEnabled: boolean,
): ReviewParties {
  if (reviewerUserId === order.buyerUserId) {
    return {
      direction: 'CUSTOMER_TO_PROVIDER',
      reviewerUserId: order.buyerUserId,
      revieweeUserId: order.providerUserId,
    };
  }
  if (reviewerUserId === order.providerUserId) {
    if (!providerReviewEnabled) {
      throw reviewNotEligible('Providers cannot review customers under the current policy.');
    }
    return {
      direction: 'PROVIDER_TO_CUSTOMER',
      reviewerUserId: order.providerUserId,
      revieweeUserId: order.buyerUserId,
    };
  }
  throw reviewNotEligible('You are not part of this order.');
}

export function isDirectionAllowed(direction: ReviewDirection, providerReviewEnabled: boolean) {
  return direction === 'CUSTOMER_TO_PROVIDER' || providerReviewEnabled;
}

/**
 * Running average, rounded to the two decimals `provider_profiles.rating_avg`
 * stores (`@db.Decimal(3, 2)`).
 */
export function nextRatingAverage(
  currentAverage: number | null,
  currentCount: number,
  rating: number,
): { ratingAvg: number; ratingCount: number } {
  const ratingCount = currentCount + 1;
  const total = (currentAverage ?? 0) * currentCount + rating;
  return { ratingAvg: Math.round((total / ratingCount) * 100) / 100, ratingCount };
}

export function assertPage(page: number): number {
  if (!Number.isInteger(page) || page < 1) {
    throw reviewInvalidRequest('A page must be a whole number of at least 1.');
  }
  return page;
}

export function assertPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_REVIEW_PAGE_SIZE) {
    throw reviewInvalidRequest(`A page size must be between 1 and ${MAX_REVIEW_PAGE_SIZE}.`);
  }
  return pageSize;
}
