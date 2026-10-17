import { HttpException } from '@nestjs/common';

import { ProviderDomainError } from '../../provider/domain/provider.errors';
import { AvailabilityDomainError } from '../domain/availability.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * Availability resolves the provider through the provider context, so provider
 * errors keep their contract code (`NOT_FOUND`) instead of becoming a 500.
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof AvailabilityDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ProviderDomainError) {
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
