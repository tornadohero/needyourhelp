import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the order context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class OrderDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OrderDomainError';
  }
}

/** Unknown order, or one the caller is not part of: the same answer. */
export function orderNotFound(message = 'Order not found.'): OrderDomainError {
  return new OrderDomainError('NOT_FOUND', 404, message);
}

/** The order exists but the caller may not act on it. */
export function orderForbidden(message = 'Not permitted.'): OrderDomainError {
  return new OrderDomainError('FORBIDDEN', 403, message);
}

/** Bad input: an impossible window, a note that is too long, a bad page. */
export function orderInvalidRequest(message: string): OrderDomainError {
  return new OrderDomainError('VALIDATION_ERROR', 400, message);
}

/**
 * A command the state machine does not allow, or a gate that is closed.
 *
 * `specs/05-api-spec.md` defines `ORDER_INVALID_STATE` (409) for exactly this.
 */
export function orderInvalidState(message: string): OrderDomainError {
  return new OrderDomainError('ORDER_INVALID_STATE', 409, message);
}
