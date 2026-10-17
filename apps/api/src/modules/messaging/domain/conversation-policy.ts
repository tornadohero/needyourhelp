import { MAX_REPORT_DESCRIPTION_LENGTH } from '../../moderation/domain/moderation-policy';
import { messagingInvalidState } from './messaging.errors';

/**
 * What the server accepts for a conversation
 * (`specs/09-im-spec.md` §Conversation creation, §Message policy).
 *
 * The conditions the spec lists are: both users active, neither blocks the
 * other, the target provider is discoverable and anti-spam limits pass. The
 * first three are enforced here and in the service; anti-spam/rate limits are
 * T022 (`specs/13-security-spec.md`), which owns rate limiting for messaging.
 */

/** A listing is always bounded (`specs/05-api-spec.md` has no paging contract). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** Two counterparties: the platform does not create group chats in V1. */
export const MAX_CONVERSATION_MEMBERS = 2;

/** A conversation is between two different accounts. */
export function assertPeer(selfUserId: string, peerUserId: string): string {
  if (peerUserId === selfUserId) {
    throw messagingInvalidState('A conversation needs another participant.');
  }
  return peerUserId;
}

export function assertPage(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw messagingInvalidState('page must be a positive integer.');
  }
  return value;
}

export function assertPageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw messagingInvalidState(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

export function assertReportDescription(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const description = value.trim();
  if (description.length === 0) {
    return null;
  }
  if (description.length > MAX_REPORT_DESCRIPTION_LENGTH) {
    throw messagingInvalidState(
      `A report description must be at most ${MAX_REPORT_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}
