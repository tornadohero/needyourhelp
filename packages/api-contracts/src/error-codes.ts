/**
 * Machine-readable API error codes.
 *
 * Source of truth: `specs/05-api-spec.md` §Error codes.
 * Codes are stable contract values: clients branch on `code`, never on `message`.
 */
export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PROVIDER_NOT_APPROVED: 'PROVIDER_NOT_APPROVED',
  SERVICE_NOT_PUBLISHED: 'SERVICE_NOT_PUBLISHED',
  ORDER_NOT_PAYABLE: 'ORDER_NOT_PAYABLE',
  ORDER_INVALID_STATE: 'ORDER_INVALID_STATE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CALLBACK_INVALID: 'PAYMENT_CALLBACK_INVALID',
  REFUND_NOT_ALLOWED: 'REFUND_NOT_ALLOWED',
  REVIEW_NOT_ELIGIBLE: 'REVIEW_NOT_ELIGIBLE',
  BLOCKED_USER: 'BLOCKED_USER',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  CHILD_ACCESS_DENIED: 'CHILD_ACCESS_DENIED',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * `specs/05-api-spec.md` does not define a generic server-error code.
 * Unhandled failures must never leak internals, so an explicit placeholder is used
 * instead of reusing a domain code. Tracked as a spec gap; do not use it for domain errors.
 */
export const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';

/** Default HTTP status for each code, used by the global exception filter. */
export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  PROVIDER_NOT_APPROVED: 409,
  SERVICE_NOT_PUBLISHED: 409,
  ORDER_NOT_PAYABLE: 409,
  ORDER_INVALID_STATE: 409,
  PAYMENT_FAILED: 402,
  PAYMENT_CALLBACK_INVALID: 400,
  REFUND_NOT_ALLOWED: 409,
  REVIEW_NOT_ELIGIBLE: 409,
  BLOCKED_USER: 403,
  CONSENT_REQUIRED: 403,
  CHILD_ACCESS_DENIED: 403,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
};
