import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the teacher-compliance context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ComplianceDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ComplianceDomainError';
  }
}

export function complianceNotFound(
  message = 'Provider capability not found.',
): ComplianceDomainError {
  return new ComplianceDomainError('NOT_FOUND', 404, message);
}

/**
 * Illegal compliance state change or an unusable restriction.
 *
 * `specs/05-api-spec.md` defines no compliance-specific code, so the generic
 * `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function complianceInvalidState(message: string): ComplianceDomainError {
  return new ComplianceDomainError('VALIDATION_ERROR', 400, message);
}

/**
 * The capability is not permitted to deliver the requested service.
 *
 * Raised by the orderability gate when the compliance state does not permit the
 * service (`specs/06` §Teacher compliance).
 */
export function complianceNotPermitted(
  message = 'This provider capability is not permitted to deliver the requested service.',
): ComplianceDomainError {
  return new ComplianceDomainError('FORBIDDEN', 403, message);
}
