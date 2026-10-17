import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the moderation context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class ModerationDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModerationDomainError';
  }
}

/** Unknown report or case, or one the caller has nothing to do with. */
export function moderationNotFound(message = 'Not found.'): ModerationDomainError {
  return new ModerationDomainError('NOT_FOUND', 404, message);
}

/** Known, but not yours to act on. */
export function moderationForbidden(message = 'Not permitted.'): ModerationDomainError {
  return new ModerationDomainError('FORBIDDEN', 403, message);
}

/**
 * Illegal input or an illegal transition: the state machine of
 * `specs/06-verification-state-machine.md` §Moderation is the rule, and a status
 * is never patched into place.
 */
export function moderationInvalidRequest(message: string): ModerationDomainError {
  return new ModerationDomainError('VALIDATION_ERROR', 400, message);
}
