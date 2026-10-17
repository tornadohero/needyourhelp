import type {
  ModerationActionName,
  ModerationCaseStatusName,
  ModerationTargetTypeName,
} from '@mentor/api-contracts';

import { moderationInvalidRequest, moderationNotFound } from './moderation.errors';

/**
 * The moderation state machine and its rules
 * (`specs/06-verification-state-machine.md` §Moderation,
 * `specs/12-admin-spec.md` §Moderation, `specs/01-business-rules.md` §Review).
 *
 * Two rules shape this file: a case only moves through the transitions below —
 * never an arbitrary status write — and an appeal is reviewed by somebody other
 * than the moderator whose decision is being appealed.
 */

/** `moderation_cases.status` values that mean "already being handled". */
export const ACTIVE_MODERATION_STATUSES: readonly ModerationCaseStatusName[] = [
  'OPEN',
  'INVESTIGATING',
  'ACTION_REQUIRED',
  'APPEALED',
];

export const MODERATION_TRANSITIONS: Record<
  ModerationCaseStatusName,
  readonly ModerationCaseStatusName[]
> = {
  OPEN: ['INVESTIGATING', 'ACTION_REQUIRED', 'RESOLVED'],
  INVESTIGATING: ['ACTION_REQUIRED', 'RESOLVED'],
  ACTION_REQUIRED: ['RESOLVED'],
  // A resolved case can be appealed; it can also be closed for good.
  RESOLVED: ['APPEALED', 'FINALIZED'],
  // An appeal ends in a final decision, never back in the same hands.
  APPEALED: ['FINALIZED'],
  FINALIZED: [],
};

export const MAX_REPORT_DESCRIPTION_LENGTH = 2_000;
export const MAX_RESOLUTION_LENGTH = 500;
export const MAX_APPEAL_REASON_LENGTH = 500;

export const DEFAULT_QUEUE_PAGE_SIZE = 20;
export const MAX_QUEUE_PAGE_SIZE = 50;

/** Which targets an action may be taken on. */
const ACTION_TARGETS: Record<ModerationActionName, readonly ModerationTargetTypeName[]> = {
  NO_ACTION: ['USER', 'PROVIDER', 'SERVICE', 'ORDER', 'REVIEW', 'MESSAGE', 'CONVERSATION'],
  HIDE_REVIEW: ['REVIEW'],
  DISPUTE_ORDER: ['ORDER'],
};

export function canTransitionCase(
  from: ModerationCaseStatusName,
  to: ModerationCaseStatusName,
): boolean {
  return MODERATION_TRANSITIONS[from].includes(to);
}

export function assertCaseTransition(
  from: ModerationCaseStatusName,
  to: ModerationCaseStatusName,
): void {
  if (!canTransitionCase(from, to)) {
    throw moderationInvalidRequest(`A case in status ${from} cannot move to ${to}.`);
  }
}

/**
 * An action is only allowed where it means something: hiding content is a
 * review decision and disputing is an order decision.
 */
export function assertActionAllowed(
  action: ModerationActionName,
  targetType: ModerationTargetTypeName,
): void {
  if (!ACTION_TARGETS[action].includes(targetType)) {
    throw moderationInvalidRequest(
      `The action ${action} does not apply to a target of type ${targetType}.`,
    );
  }
}

/**
 * `specs/12-admin-spec.md` §Admin principles: "No silent data edits" and
 * "Financial operations require reason". A decision without a written reason is
 * refused.
 */
export function assertResolution(value: string): string {
  const resolution = value.trim();
  if (resolution.length === 0) {
    throw moderationInvalidRequest('A moderation decision requires a reason.');
  }
  if (resolution.length > MAX_RESOLUTION_LENGTH) {
    throw moderationInvalidRequest(
      `A decision reason must be at most ${MAX_RESOLUTION_LENGTH} characters.`,
    );
  }
  return resolution;
}

export function assertAppealReason(value: string): string {
  const reason = value.trim();
  if (reason.length === 0) {
    throw moderationInvalidRequest('An appeal requires a reason.');
  }
  if (reason.length > MAX_APPEAL_REASON_LENGTH) {
    throw moderationInvalidRequest(
      `An appeal reason must be at most ${MAX_APPEAL_REASON_LENGTH} characters.`,
    );
  }
  return reason;
}

export function assertDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const description = value.trim();
  if (description.length === 0) {
    return null;
  }
  if (description.length > MAX_REPORT_DESCRIPTION_LENGTH) {
    throw moderationInvalidRequest(
      `A report description must be at most ${MAX_REPORT_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}

/**
 * `specs/06` §Moderation: "Appeal must be independently reviewed where
 * feasible." The reviewer of an appeal cannot be the moderator who decided it.
 */
export function assertIndependentReview(actorUserId: string, decidedByUserId: string | null): void {
  if (decidedByUserId !== null && actorUserId === decidedByUserId) {
    throw moderationInvalidRequest(
      'An appeal must be reviewed by somebody other than the moderator who decided it.',
    );
  }
}

export function assertPage(page: number): number {
  if (!Number.isInteger(page) || page < 1) {
    throw moderationInvalidRequest('A page must be a whole number of at least 1.');
  }
  return page;
}

export function assertPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_QUEUE_PAGE_SIZE) {
    throw moderationInvalidRequest(`A page size must be between 1 and ${MAX_QUEUE_PAGE_SIZE}.`);
  }
  return pageSize;
}

/** A target id is a uuid: a malformed one never reaches the database. */
export function assertTargetId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw moderationNotFound('Unknown target.');
  }
  return id;
}
