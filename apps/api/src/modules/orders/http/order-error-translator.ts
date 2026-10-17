import { HttpException } from '@nestjs/common';

import { IdempotencyConflictError } from '../../../common/idempotency/idempotency.store';
import { ComplianceDomainError } from '../../compliance/domain/compliance.errors';
import { AvailabilityDomainError } from '../../availability/domain/availability.errors';
import { ServiceDomainError } from '../../services/domain/service.errors';
import { ProviderDomainError } from '../../provider/domain/provider.errors';
import { OrderDomainError } from '../domain/order.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * An order is created across four contexts (service, provider/discovery,
 * compliance, availability); their errors keep their contract code instead of
 * becoming a 500.
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof OrderDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ServiceDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof AvailabilityDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ComplianceDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ProviderDomainError) {
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
