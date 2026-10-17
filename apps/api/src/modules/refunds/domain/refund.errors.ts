import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the refund context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class RefundDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RefundDomainError';
  }
}

/** Unknown order, or one the caller is not part of: the same answer. */
export function refundNotFound(message = 'Order not found.'): RefundDomainError {
  return new RefundDomainError('NOT_FOUND', 404, message);
}

/** Not the buyer of the order. */
export function refundForbidden(message = 'Not permitted.'): RefundDomainError {
  return new RefundDomainError('FORBIDDEN', 403, message);
}

/** Illegal input: a reason that is too long, a malformed amount. */
export function refundInvalidRequest(message: string): RefundDomainError {
  return new RefundDomainError('VALIDATION_ERROR', 400, message);
}

/**
 * The policy engine said no: unpaid order, wrong state, or an amount larger than
 * what was captured (`specs/05-api-spec.md` defines `REFUND_NOT_ALLOWED`).
 */
export function refundNotAllowed(message: string): RefundDomainError {
  return new RefundDomainError('REFUND_NOT_ALLOWED', 409, message);
}
