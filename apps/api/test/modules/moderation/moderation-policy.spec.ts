import { describe, expect, it } from 'vitest';

import {
  ACTIVE_MODERATION_STATUSES,
  MODERATION_TRANSITIONS,
  assertActionAllowed,
  assertAppealReason,
  assertCaseTransition,
  assertDescription,
  assertIndependentReview,
  assertPage,
  assertPageSize,
  assertResolution,
  assertTargetId,
  canTransitionCase,
} from '../../../src/modules/moderation/domain/moderation-policy';

describe('moderation policy', () => {
  it('knows which cases are still being handled', () => {
    // "At most one active case per target" (`specs/04-database-spec.md`).
    expect(ACTIVE_MODERATION_STATUSES).toContain('OPEN');
    expect(ACTIVE_MODERATION_STATUSES).toContain('INVESTIGATING');
    expect(ACTIVE_MODERATION_STATUSES).toContain('ACTION_REQUIRED');
    expect(ACTIVE_MODERATION_STATUSES).toContain('APPEALED');
    expect(ACTIVE_MODERATION_STATUSES).not.toContain('RESOLVED');
    expect(ACTIVE_MODERATION_STATUSES).not.toContain('FINALIZED');
  });

  it('moves a case only along the state machine of specs/06', () => {
    expect(canTransitionCase('OPEN', 'INVESTIGATING')).toBe(true);
    expect(canTransitionCase('INVESTIGATING', 'ACTION_REQUIRED')).toBe(true);
    expect(canTransitionCase('OPEN', 'RESOLVED')).toBe(true);
    expect(canTransitionCase('RESOLVED', 'APPEALED')).toBe(true);
    expect(canTransitionCase('APPEALED', 'FINALIZED')).toBe(true);

    // Backwards, and out of order, are illegal: a status is never patched.
    expect(canTransitionCase('RESOLVED', 'OPEN')).toBe(false);
    expect(canTransitionCase('OPEN', 'APPEALED')).toBe(false);
    expect(canTransitionCase('OPEN', 'FINALIZED')).toBe(false);
    expect(canTransitionCase('FINALIZED', 'OPEN')).toBe(false);
    // An appeal ends in a final decision, never back in the same hands.
    expect(canTransitionCase('APPEALED', 'RESOLVED')).toBe(false);

    expect(() => assertCaseTransition('FINALIZED', 'OPEN')).toThrow(/cannot move to/);
    expect(MODERATION_TRANSITIONS.FINALIZED).toHaveLength(0);
  });

  it('allows an action only on the target it belongs to', () => {
    expect(() => assertActionAllowed('HIDE_REVIEW', 'REVIEW')).not.toThrow();
    expect(() => assertActionAllowed('DISPUTE_ORDER', 'ORDER')).not.toThrow();
    expect(() => assertActionAllowed('NO_ACTION', 'USER')).not.toThrow();

    // Hiding content is a review decision; disputing is an order decision.
    expect(() => assertActionAllowed('HIDE_REVIEW', 'USER')).toThrow(/does not apply/);
    expect(() => assertActionAllowed('DISPUTE_ORDER', 'REVIEW')).toThrow(/does not apply/);
  });

  it('requires a written reason for every decision', () => {
    expect(() => assertResolution('   ')).toThrow(/requires a reason/);
    expect(assertResolution(' 证据不足 ')).toBe('证据不足');
    expect(() => assertResolution('x'.repeat(501))).toThrow(/at most/);

    expect(() => assertAppealReason('')).toThrow(/requires a reason/);
    expect(assertAppealReason(' 我没有违规 ')).toBe('我没有违规');
  });

  it('bounds the intake text', () => {
    expect(assertDescription(undefined)).toBeNull();
    expect(assertDescription('   ')).toBeNull();
    expect(assertDescription(' 骚扰 ')).toBe('骚扰');
    expect(() => assertDescription('x'.repeat(2001))).toThrow(/description/);
  });

  it('refuses an appeal reviewed by the moderator who decided it', () => {
    expect(() => assertIndependentReview('admin-2', 'admin-1')).not.toThrow();
    expect(() => assertIndependentReview('admin-2', null)).not.toThrow();
    expect(() => assertIndependentReview('admin-1', 'admin-1')).toThrow(/somebody other than/);
  });

  it('rejects a target that is not a uuid, and bounds the page', () => {
    expect(assertTargetId('00000000-0000-4000-8000-0000000000aa')).toContain('00000000');
    expect(() => assertTargetId('not-a-uuid')).toThrow(/Unknown target/);
    expect(() => assertTargetId('../etc/passwd')).toThrow(/Unknown target/);

    expect(assertPage(1)).toBe(1);
    expect(() => assertPage(0)).toThrow(/page/);
    expect(assertPageSize(50)).toBe(50);
    expect(() => assertPageSize(51)).toThrow(/page size/);
  });
});
