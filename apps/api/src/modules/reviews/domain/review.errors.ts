import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the review context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ReviewDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewDomainError';
  }
}

/** Unknown order, unknown provider, or one the caller has nothing to do with. */
export function reviewNotFound(message = 'Not found.'): ReviewDomainError {
  return new ReviewDomainError('NOT_FOUND', 404, message);
}

/** Part of the order, but not allowed to write this review. */
export function reviewForbidden(message = 'Not permitted.'): ReviewDomainError {
  return new ReviewDomainError('FORBIDDEN', 403, message);
}

/** Illegal input: a rating off the scale, content that is too long. */
export function reviewInvalidRequest(message: string): ReviewDomainError {
  return new ReviewDomainError('VALIDATION_ERROR', 400, message);
}

/**
 * `specs/05-api-spec.md`: `REVIEW_NOT_ELIGIBLE` — the order is not completed,
 * the reviewer already reviewed this direction, or the direction is not allowed
 * by policy.
 */
export function reviewNotEligible(message: string): ReviewDomainError {
  return new ReviewDomainError('REVIEW_NOT_ELIGIBLE', 409, message);
}
