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

/**
 * A signed object URL that does not hold: tampered, expired, or replayed with
 * the wrong purpose. Answered as `FORBIDDEN` so the reason is not spelled out to
 * whoever is probing (`specs/13-security-spec.md` §File upload).
 */
export function signedUrlInvalid(
  message = 'This object URL is not valid.',
): VerificationDomainError {
  return new VerificationDomainError('FORBIDDEN', 403, message);
}

/** An upload that exceeds the configured document size (`specs/13` §API). */
export function documentTooLarge(message = 'The document is too large.'): VerificationDomainError {
  return new VerificationDomainError('VALIDATION_ERROR', 413, message);
}

/** A content type outside the whitelist (`specs/13` §File upload). */
export function documentContentTypeRejected(
  message = 'That document type is not accepted.',
): VerificationDomainError {
  return new VerificationDomainError('VALIDATION_ERROR', 415, message);
}
