import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the availability context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class AvailabilityDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AvailabilityDomainError';
  }
}

export function slotNotFound(message = 'Availability slot not found.'): AvailabilityDomainError {
  return new AvailabilityDomainError('NOT_FOUND', 404, message);
}

/** The slot exists but belongs to another provider. */
export function slotForbidden(message = 'Not permitted.'): AvailabilityDomainError {
  return new AvailabilityDomainError('FORBIDDEN', 403, message);
}

/**
 * Illegal time window, an overlapping slot, or an action that would break a
 * confirmed booking.
 *
 * `specs/05-api-spec.md` defines no availability-specific conflict code, so the
 * generic `VALIDATION_ERROR` is used (tracked as a spec gap).
 */
export function slotInvalidState(message: string): AvailabilityDomainError {
  return new AvailabilityDomainError('VALIDATION_ERROR', 400, message);
}

/** The window is already covered by another slot of the same provider. */
export function slotOverlapError(
  message = 'This time overlaps another availability slot of this provider.',
): AvailabilityDomainError {
  return new AvailabilityDomainError('VALIDATION_ERROR', 400, message);
}

/** No bookable slot covers the requested time: it would overlap a booking. */
export function slotUnavailable(
  message = 'The requested time is not available; it overlaps a confirmed booking.',
): AvailabilityDomainError {
  return new AvailabilityDomainError('VALIDATION_ERROR', 400, message);
}
