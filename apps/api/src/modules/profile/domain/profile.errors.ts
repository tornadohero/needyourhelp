import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the profile/child/consent use cases.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ProfileDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProfileDomainError';
  }
}

/** No such resource, or it was soft-deleted. */
export function profileNotFound(message = 'Resource not found.'): ProfileDomainError {
  return new ProfileDomainError('NOT_FOUND', 404, message);
}

/** Authenticated but not permitted. */
export function profileForbidden(message = 'Not permitted.'): ProfileDomainError {
  return new ProfileDomainError('FORBIDDEN', 403, message);
}

/**
 * The account is not the guardian of the child.
 *
 * `specs/05-api-spec.md` defines `CHILD_ACCESS_DENIED` for this case; it is used
 * instead of a generic 403 so clients can distinguish it, and instead of 404 so
 * an accidental leak is visible in tests (`specs/14-test-strategy.md` E2E-06).
 */
export function childAccessDenied(
  message = 'Child profile is not accessible to this account.',
): ProfileDomainError {
  return new ProfileDomainError('CHILD_ACCESS_DENIED', 403, message);
}

/** Guardian consent is missing for an operation that processes child data. */
export function consentRequired(
  message = 'Guardian consent is required before processing child data.',
): ProfileDomainError {
  return new ProfileDomainError('CONSENT_REQUIRED', 403, message);
}
