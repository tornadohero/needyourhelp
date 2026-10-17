import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the service context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ServiceDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceDomainError';
  }
}

export function serviceNotFound(message = 'Service not found.'): ServiceDomainError {
  return new ServiceDomainError('NOT_FOUND', 404, message);
}

/** The service exists but belongs to another provider. */
export function serviceForbidden(message = 'Not permitted.'): ServiceDomainError {
  return new ServiceDomainError('FORBIDDEN', 403, message);
}

/**
 * Illegal publication transition or edit.
 *
 * `specs/05-api-spec.md` defines no service-specific conflict code, so the
 * generic `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function serviceInvalidState(message: string): ServiceDomainError {
  return new ServiceDomainError('VALIDATION_ERROR', 400, message);
}

/**
 * Ordering a service that is not published (`specs/02-domain-model.md`:
 * "Service cannot be ordered unless provider and service are active").
 */
export function serviceNotPublished(
  message = 'Service is not published and cannot be ordered.',
): ServiceDomainError {
  return new ServiceDomainError('SERVICE_NOT_PUBLISHED', 409, message);
}
