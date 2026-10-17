import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the provider context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ProviderDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderDomainError';
  }
}

export function providerNotFound(message = 'Provider profile not found.'): ProviderDomainError {
  return new ProviderDomainError('NOT_FOUND', 404, message);
}

/** Operation attempted on a provider that is not approved. */
export function providerNotApproved(
  message = 'Provider is not approved; publishing is not allowed.',
): ProviderDomainError {
  return new ProviderDomainError('PROVIDER_NOT_APPROVED', 409, message);
}

/**
 * Illegal provider state change or edit.
 *
 * `specs/05-api-spec.md` defines no provider-specific conflict code, so the
 * generic `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function providerInvalidState(message: string): ProviderDomainError {
  return new ProviderDomainError('VALIDATION_ERROR', 400, message);
}

export function providerForbidden(message = 'Not permitted.'): ProviderDomainError {
  return new ProviderDomainError('FORBIDDEN', 403, message);
}
