import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the catalog context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class CatalogDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogDomainError';
  }
}

export function taxonomyNotFound(message = 'Taxonomy term not found.'): CatalogDomainError {
  return new CatalogDomainError('NOT_FOUND', 404, message);
}

/**
 * Unusable term payload or an illegal structural change.
 *
 * `specs/05-api-spec.md` defines no catalog-specific code, so the generic
 * `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function taxonomyInvalid(message: string): CatalogDomainError {
  return new CatalogDomainError('VALIDATION_ERROR', 400, message);
}
