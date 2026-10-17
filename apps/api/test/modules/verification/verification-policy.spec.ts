import { describe, expect, it } from 'vitest';

import type { VerificationType } from '../../../src/modules/verification/domain/verification-case.model';
import {
  REQUIRED_VERIFICATION_TYPES,
  verificationLevelFor,
} from '../../../src/modules/verification/domain/verification-case.model';
import {
  VERIFICATION_TRANSITIONS,
  canTransition,
  isDecidable,
  isEditable,
  isVerificationSatisfied,
  submissionTarget,
} from '../../../src/modules/verification/domain/verification-policy';

describe('identity verification state machine', () => {
  it('follows the spec transitions', () => {
    expect(VERIFICATION_TRANSITIONS.DRAFT).toEqual(['SUBMITTED']);
    expect(VERIFICATION_TRANSITIONS.SUBMITTED).toContain('UNDER_REVIEW');
    expect(VERIFICATION_TRANSITIONS.UNDER_REVIEW).toEqual(['APPROVED', 'REJECTED']);
    expect(VERIFICATION_TRANSITIONS.RESUBMITTED).toContain('APPROVED');
    expect(VERIFICATION_TRANSITIONS.REJECTED).toEqual(['RESUBMITTED']);
  });

  it('treats approval as terminal and rejection as resubmittable', () => {
    expect(VERIFICATION_TRANSITIONS.APPROVED).toEqual([]);
    expect(canTransition('REJECTED', 'RESUBMITTED')).toBe(true);
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('SUBMITTED', 'SUBMITTED')).toBe(false);
  });

  it('only lets evidence be attached before a decision is pending', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('RESUBMITTED')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
    expect(isEditable('UNDER_REVIEW')).toBe(false);
    expect(isEditable('APPROVED')).toBe(false);
    expect(isEditable('REJECTED')).toBe(false);
  });

  it('submits a draft as SUBMITTED and a rejection as RESUBMITTED', () => {
    expect(submissionTarget('DRAFT')).toBe('SUBMITTED');
    expect(submissionTarget('REJECTED')).toBe('RESUBMITTED');
    expect(submissionTarget('SUBMITTED')).toBeNull();
    expect(submissionTarget('UNDER_REVIEW')).toBeNull();
    expect(submissionTarget('APPROVED')).toBeNull();
    expect(submissionTarget('RESUBMITTED')).toBeNull();
  });

  it('only lets an admin decide a case awaiting review', () => {
    expect(isDecidable('SUBMITTED')).toBe(true);
    expect(isDecidable('UNDER_REVIEW')).toBe(true);
    expect(isDecidable('RESUBMITTED')).toBe(true);
    expect(isDecidable('DRAFT')).toBe(false);
    expect(isDecidable('APPROVED')).toBe(false);
    expect(isDecidable('REJECTED')).toBe(false);
  });
});

describe('verification level', () => {
  it('maps approved case types onto the capability level', () => {
    expect(verificationLevelFor([])).toBe('NONE');
    expect(verificationLevelFor(['IDENTITY'])).toBe('IDENTITY');
    expect(verificationLevelFor(['EDUCATION'])).toBe('EDUCATION');
    expect(verificationLevelFor(['IDENTITY', 'EDUCATION'])).toBe('FULL');
    expect(verificationLevelFor(['TEACHER_COMPLIANCE'])).toBe('NONE');
  });
});

describe('discovery gate', () => {
  it('requires identity and education', () => {
    expect(REQUIRED_VERIFICATION_TYPES).toEqual(['IDENTITY', 'EDUCATION']);
    expect(isVerificationSatisfied(['IDENTITY', 'EDUCATION'])).toBe(true);
  });

  it('is not satisfied by one of the two', () => {
    const partial: VerificationType[][] = [[], ['IDENTITY'], ['EDUCATION'], ['TEACHER_COMPLIANCE']];
    for (const approved of partial) {
      expect(isVerificationSatisfied(approved)).toBe(false);
    }
  });
});
