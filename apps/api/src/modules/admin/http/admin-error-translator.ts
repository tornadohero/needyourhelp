import { HttpException } from '@nestjs/common';

import { AdminDomainError } from '../domain/admin.errors';
import { PlatformDomainError } from '../../platform/domain/platform.errors';
import { ProviderDomainError } from '../../provider/domain/provider.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * The operations pages call into the provider and platform contexts, so their
 * errors keep their contract codes instead of becoming a 500.
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof AdminDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ProviderDomainError) {
    throw new HttpException({ code: error.code, message: error.message }, error.status);
  }
  if (error instanceof PlatformDomainError) {
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
