import { HttpException } from '@nestjs/common';

import { OrderDomainError } from '../../orders/domain/order.errors';
import { ReviewDomainError } from '../domain/review.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * Reviews are created through an order, so an order error keeps its contract
 * code (`ORDER_INVALID_STATE`) instead of becoming a 500.
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof ReviewDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof OrderDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
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
