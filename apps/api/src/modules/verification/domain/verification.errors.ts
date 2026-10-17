import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the verification context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class VerificationDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VerificationDomainError';
  }
}

export function verificationNotFound(
  message = 'Verification case not found.',
): VerificationDomainError {
  return new VerificationDomainError('NOT_FOUND', 404, message);
}

/** The case exists but belongs to another provider. */
export function verificationForbidden(
  message = 'Not permitted to access this verification case.',
): VerificationDomainError {
  return new VerificationDomainError('FORBIDDEN', 403, message);
}

/**
 * Illegal verification state change or invalid intake.
 *
 * `specs/05-api-spec.md` defines no verification-specific conflict code, so the
 * generic `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function verificationInvalidState(message: string): VerificationDomainError {
  return new VerificationDomainError('VALIDATION_ERROR', 400, message);
}
