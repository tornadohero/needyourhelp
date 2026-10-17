import type {
  ProviderReviewListResponse,
  ReviewListResponse,
  ReviewResponse,
} from '@mentor/api-contracts';

import type { Review } from '../domain/review.model';

/**
 * Response mappers for reviews.
 *
 * Allowlists, never ORM serialization (`AGENTS.md` §10): a review response
 * carries the order, the two parties, the rating and the text — and never the
 * child profile behind the order (`specs/10-privacy-and-minors.md`).
 */
export function toReviewResponse(review: Review): ReviewResponse {
  return {
    id: review.id,
    orderId: review.orderId,
    reviewerUserId: review.reviewerUserId,
    revieweeUserId: review.revieweeUserId,
    rating: review.rating,
    content: review.status === 'PUBLISHED' ? review.content : null,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export function toReviewListResponse(result: {
  items: Review[];
  total: number;
}): ReviewListResponse {
  return { items: result.items.map(toReviewResponse), total: result.total };
}

export function toProviderReviewListResponse(result: {
  items: Review[];
  total: number;
  page: number;
  pageSize: number;
}): ProviderReviewListResponse {
  return {
    items: result.items.map(toReviewResponse),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}
