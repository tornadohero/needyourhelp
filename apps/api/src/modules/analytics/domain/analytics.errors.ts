import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for analytics.
 *
 * Analytics is a side effect, never a reason to fail a request: these exist so a
 * caller that builds events (tests, an ingest endpoint) gets a precise answer,
 * while the emitters swallow them (`specs/03` §Observability).
 */
export class AnalyticsDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AnalyticsDomainError';
  }
}

export function analyticsInvalidEvent(message: string): AnalyticsDomainError {
  return new AnalyticsDomainError('VALIDATION_ERROR', 400, message);
}
