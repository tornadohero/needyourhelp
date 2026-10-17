import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the platform configuration context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class PlatformDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformDomainError';
  }
}

export function platformNotFound(message = 'Not found.'): PlatformDomainError {
  return new PlatformDomainError('NOT_FOUND', 404, message);
}

export function platformInvalidRequest(message: string): PlatformDomainError {
  return new PlatformDomainError('VALIDATION_ERROR', 400, message);
}

export function platformConflict(message: string): PlatformDomainError {
  return new PlatformDomainError('VALIDATION_ERROR', 409, message);
}
