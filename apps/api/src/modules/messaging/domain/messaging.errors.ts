import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the messaging context.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6).
 */
export class MessagingDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingDomainError';
  }
}

/** Unknown conversation, or one the caller is not a member of: same answer. */
export function conversationNotFound(message = 'Conversation not found.'): MessagingDomainError {
  return new MessagingDomainError('NOT_FOUND', 404, message);
}

/** A conversation one may see but not act on. */
export function conversationForbidden(message = 'Not permitted.'): MessagingDomainError {
  return new MessagingDomainError('FORBIDDEN', 403, message);
}

/**
 * A blocked user cannot start a new conversation
 * (`specs/09-im-spec.md` §Safety) — in either direction.
 */
export function blockedUser(
  message = 'Messaging is blocked between these users.',
): MessagingDomainError {
  return new MessagingDomainError('BLOCKED_USER', 403, message);
}

/** Illegal input: self-chat, an unknown peer, a frozen conversation. */
export function messagingInvalidState(message: string): MessagingDomainError {
  return new MessagingDomainError('VALIDATION_ERROR', 400, message);
}
