import { describe, expect, it } from 'vitest';

import {
  MAX_REVIEW_CONTENT_LENGTH,
  PROVIDER_REVIEW_CUSTOMER_FLAG,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  assertContent,
  assertOrderReviewable,
  assertPage,
  assertPageSize,
  assertRating,
  isDirectionAllowed,
  nextRatingAverage,
  resolveParties,
} from '../../../src/modules/reviews/domain/review-policy';

const BUYER = '11111111-1111-4111-8111-111111111111';
const PROVIDER_USER = '22222222-2222-4222-8222-222222222222';

const ORDER = { buyerUserId: BUYER, providerUserId: PROVIDER_USER };

describe('review policy', () => {
  it('allows a review only once the order is completed', () => {
    expect(() => assertOrderReviewable('COMPLETED')).not.toThrow();

    for (const status of [
      'PENDING_PAYMENT',
      'PAID',
      'CONFIRMED',
      'IN_PROGRESS',
      'CANCELLED',
      'REFUND_PENDING',
      'REFUNDED',
      'DISPUTED',
    ] as const) {
      expect(() => assertOrderReviewable(status), status).toThrow(/cannot be reviewed/);
    }
  });

  it('keeps the rating on the scale', () => {
    for (const rating of [REVIEW_RATING_MIN, 3, REVIEW_RATING_MAX]) {
      expect(assertRating(rating)).toBe(rating);
    }
    for (const rating of [0, 6, -1, 2.5, Number.NaN]) {
      expect(() => assertRating(rating), String(rating)).toThrow(/whole number/);
    }
  });

  it('bounds the review text', () => {
    expect(assertContent(undefined)).toBeNull();
    expect(assertContent('   ')).toBeNull();
    expect(assertContent(' 讲得很好 ')).toBe('讲得很好');
    expect(() => assertContent('x'.repeat(MAX_REVIEW_CONTENT_LENGTH + 1))).toThrow(/characters/);
  });

  it('resolves the direction and who is being reviewed', () => {
    const byCustomer = resolveParties(BUYER, ORDER, false);
    expect(byCustomer).toEqual({
      direction: 'CUSTOMER_TO_PROVIDER',
      reviewerUserId: BUYER,
      revieweeUserId: PROVIDER_USER,
    });

    // The provider direction is policy-gated.
    expect(() => resolveParties(PROVIDER_USER, ORDER, false)).toThrow(/Providers cannot review/);
    expect(resolveParties(PROVIDER_USER, ORDER, true)).toEqual({
      direction: 'PROVIDER_TO_CUSTOMER',
      reviewerUserId: PROVIDER_USER,
      revieweeUserId: BUYER,
    });

    // Somebody else has nothing to do with this order.
    expect(() => resolveParties('33333333-3333-4333-8333-333333333333', ORDER, true)).toThrow(
      /not part of this order/,
    );

    expect(isDirectionAllowed('CUSTOMER_TO_PROVIDER', false)).toBe(true);
    expect(isDirectionAllowed('PROVIDER_TO_CUSTOMER', false)).toBe(false);
    expect(isDirectionAllowed('PROVIDER_TO_CUSTOMER', true)).toBe(true);
    expect(PROVIDER_REVIEW_CUSTOMER_FLAG).toBe('provider_review_customer_enabled');
  });

  it('rolls the average forward', () => {
    expect(nextRatingAverage(null, 0, 5)).toEqual({ ratingAvg: 5, ratingCount: 1 });
    expect(nextRatingAverage(5, 1, 4)).toEqual({ ratingAvg: 4.5, ratingCount: 2 });
    expect(nextRatingAverage(4.5, 2, 5)).toEqual({ ratingAvg: 4.67, ratingCount: 3 });
  });

  it('bounds the public page', () => {
    expect(assertPage(1)).toBe(1);
    expect(() => assertPage(0)).toThrow(/page/);
    expect(assertPageSize(50)).toBe(50);
    expect(() => assertPageSize(51)).toThrow(/page size/);
  });
});
