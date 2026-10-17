import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the payment context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class PaymentDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentDomainError';
  }
}

/** Unknown order or payment; the answer is the same for a probing caller. */
export function paymentNotFound(message = 'Payment not found.'): PaymentDomainError {
  return new PaymentDomainError('NOT_FOUND', 404, message);
}

/** A payment that does not belong to the caller. */
export function paymentForbidden(message = 'Not permitted.'): PaymentDomainError {
  return new PaymentDomainError('FORBIDDEN', 403, message);
}

/** The order is not in a state that can be paid. */
export function orderNotPayable(message = 'This order cannot be paid.'): PaymentDomainError {
  return new PaymentDomainError('ORDER_NOT_PAYABLE', 409, message);
}

/**
 * A malformed notification, an unknown order, or an amount that does not match
 * the order (`specs/08` §Payment invariants).
 */
export function paymentCallbackInvalid(message: string): PaymentDomainError {
  return new PaymentDomainError('PAYMENT_CALLBACK_INVALID', 400, message);
}

/** The provider reported a failure or the session was closed. */
export function paymentFailed(message = 'The payment did not succeed.'): PaymentDomainError {
  return new PaymentDomainError('PAYMENT_FAILED', 402, message);
}
