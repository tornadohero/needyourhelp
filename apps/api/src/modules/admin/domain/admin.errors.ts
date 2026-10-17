import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the operations context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class AdminDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminDomainError';
  }
}

export function adminNotFound(message = 'Not found.'): AdminDomainError {
  return new AdminDomainError('NOT_FOUND', 404, message);
}

export function adminForbidden(message = 'Not permitted.'): AdminDomainError {
  return new AdminDomainError('FORBIDDEN', 403, message);
}

export function adminInvalidRequest(message: string): AdminDomainError {
  return new AdminDomainError('VALIDATION_ERROR', 400, message);
}
