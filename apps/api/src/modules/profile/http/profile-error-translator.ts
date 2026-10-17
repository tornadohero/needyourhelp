import { HttpException } from '@nestjs/common';

import { ProfileDomainError } from '../domain/profile.errors';

/**
 * Translate domain failures into the API error envelope.
 *
 * Anything that is not a domain error is left to the global filter, which never
 * leaks internals (`specs/13-security-spec.md` §Logging).
 */
export function throwAsHttpError(error: unknown): never {
  if (error instanceof ProfileDomainError) {
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
