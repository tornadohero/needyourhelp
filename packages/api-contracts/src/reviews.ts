/**
 * Review contract (T017).
 *
 * Source of truth: `specs/01-business-rules.md` §Review,
 * `specs/04-database-spec.md` §reviews, `specs/05-api-spec.md` §Reviews,
 * `specs/06-verification-state-machine.md` §Order.
 *
 * A review exists only for an order that reached `COMPLETED`, and only once per
 * order and direction; both rules are decided by the server.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `reviews.status`: moderation may hide content, never delete the trail. */
export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;
export type ReviewStatusName = (typeof REVIEW_STATUSES)[number];

/**
 * Who reviewed whom.
 *
 * `specs/01-business-rules.md` §Review: the customer who paid may review; the
 * provider may review the customer only if policy enables it.
 */
export const REVIEW_DIRECTIONS = ['CUSTOMER_TO_PROVIDER', 'PROVIDER_TO_CUSTOMER'] as const;
export type ReviewDirectionName = (typeof REVIEW_DIRECTIONS)[number];

/** The rating scale of the platform: whole stars, `1..5`. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface ReviewResponse {
  id: string;
  orderId: string;
  reviewerUserId: string;
  revieweeUserId: string;
  rating: number;
  content: string | null;
  status: ReviewStatusName;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewListResponse {
  items: ReviewResponse[];
  total: number;
}

/** `GET /providers/:id/reviews`: public, bounded page of published reviews. */
export interface ProviderReviewListResponse extends ReviewListResponse {
  page: number;
  pageSize: number;
}
