import { HttpException } from '@nestjs/common';

import { IdempotencyConflictError } from '../../../common/idempotency/idempotency.store';
import { OrderDomainError } from '../../orders/domain/order.errors';
import { PaymentDomainError } from '../domain/payment.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * Payments resolve the order through the order context, so an order error keeps
 * its contract code (`ORDER_NOT_PAYABLE`, `ORDER_INVALID_STATE`) instead of
 * becoming a 500.
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof PaymentDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof OrderDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof IdempotencyConflictError) {
    throw new HttpException({ code: 'IDEMPOTENCY_CONFLICT', message: error.message }, 409);
  }
  throw error;
}

/** Wraps a controller action so domain errors keep their contract code. */
export async function translate<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throwAsHttpError(error);
  }
}
