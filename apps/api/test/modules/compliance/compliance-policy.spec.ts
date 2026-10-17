import { describe, expect, it } from 'vitest';

import {
  COMPLIANCE_REVIEW_STATUSES,
  COMPLIANCE_TRANSITIONS,
  canTransitionCompliance,
  isOrderable,
  requiresCompliance,
} from '../../../src/modules/compliance/domain/compliance-policy';
import {
  normalizeRestriction,
  parseRestriction,
  restrictionPermits,
} from '../../../src/modules/compliance/domain/compliance-restriction';
import type { ProviderCapability } from '../../../src/modules/provider/domain/provider-profile.model';

function capability(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
  return {
    id: 'capability-1',
    providerId: 'provider-1',
    capabilityType: 'TEACHER',
    status: 'APPROVED',
    verificationLevel: 'FULL',
    complianceStatus: 'PENDING',
    restrictionJson: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('teacher compliance state machine', () => {
  it('defines the spec transitions', () => {
    expect(COMPLIANCE_TRANSITIONS.NOT_REQUIRED).toEqual([]);
    expect(COMPLIANCE_TRANSITIONS.PENDING).toContain('UNDER_REVIEW');
    expect(COMPLIANCE_TRANSITIONS.UNDER_REVIEW).toEqual(['APPROVED', 'REJECTED', 'RESTRICTED']);
    expect(COMPLIANCE_TRANSITIONS.APPROVED).toEqual(['RESTRICTED', 'SUSPENDED']);
    expect(COMPLIANCE_TRANSITIONS.RESTRICTED).toContain('APPROVED');
    expect(COMPLIANCE_TRANSITIONS.REJECTED).toEqual(['PENDING']);
    expect(COMPLIANCE_TRANSITIONS.SUSPENDED).toContain('APPROVED');
  });

  it('lets a rejection re-enter review and treats NOT_REQUIRED as terminal', () => {
    expect(canTransitionCompliance('REJECTED', 'PENDING')).toBe(true);
    expect(canTransitionCompliance('PENDING', 'PENDING')).toBe(false);
    expect(canTransitionCompliance('NOT_REQUIRED', 'PENDING')).toBe(false);
    expect(canTransitionCompliance('UNDER_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionCompliance('APPROVED', 'APPROVED')).toBe(false);
  });

  it('reports the states a reviewer still has to act on', () => {
    expect(COMPLIANCE_REVIEW_STATUSES).toEqual(['PENDING', 'UNDER_REVIEW']);
  });

  it('requires compliance for the teacher capability only', () => {
    expect(requiresCompliance('TEACHER')).toBe(true);
    for (const type of ['STUDENT_TUTOR', 'GRADUATE_TUTOR', 'PHD_TUTOR'] as const) {
      expect(requiresCompliance(type)).toBe(false);
    }
  });
});

describe('orderability gate', () => {
  it('cannot be ordered while compliance is pending, in review, rejected or suspended', () => {
    for (const status of ['PENDING', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'] as const) {
      expect(
        isOrderable(capability({ complianceStatus: status }), { subjectCodes: ['MATH'] }),
        status,
      ).toBe(false);
    }
  });

  it('cannot be ordered even when identity and education are approved', () => {
    // `specs/06`: identity=APPROVED is not sufficient, education=APPROVED is not
    // sufficient.
    expect(
      isOrderable(capability({ complianceStatus: 'PENDING', verificationLevel: 'FULL' }), {
        subjectCodes: ['MATH'],
      }),
    ).toBe(false);
  });

  it('can be ordered without a scope once compliance is approved', () => {
    expect(isOrderable(capability({ complianceStatus: 'APPROVED' }), {})).toBe(true);
    expect(
      isOrderable(capability({ complianceStatus: 'APPROVED' }), {
        subjectCodes: ['PHYSICS'],
        cityCode: 'SHANGHAI',
      }),
    ).toBe(true);
  });

  it('does not constrain capabilities that need no compliance', () => {
    expect(
      isOrderable(
        capability({ capabilityType: 'GRADUATE_TUTOR', complianceStatus: 'NOT_REQUIRED' }),
        {},
      ),
    ).toBe(true);
  });

  it('restricts a restricted teacher to the granted service', () => {
    const restricted = capability({
      complianceStatus: 'RESTRICTED',
      restrictionJson: { allowedSubjectCodes: ['MATH'], allowedCityCodes: ['BEIJING'] },
    });

    expect(isOrderable(restricted, { subjectCodes: ['MATH'], cityCode: 'BEIJING' })).toBe(true);
    expect(isOrderable(restricted, { subjectCodes: ['PHYSICS'], cityCode: 'BEIJING' })).toBe(false);
    expect(isOrderable(restricted, { subjectCodes: ['MATH'], cityCode: 'SHANGHAI' })).toBe(false);
    expect(
      isOrderable(restricted, { subjectCodes: ['MATH', 'PHYSICS'], cityCode: 'BEIJING' }),
    ).toBe(true);
  });

  it('denies a restriction that grants nothing', () => {
    expect(
      isOrderable(capability({ complianceStatus: 'RESTRICTED' }), { subjectCodes: ['MATH'] }),
    ).toBe(false);
  });

  it('expires a time-scoped restriction', () => {
    const restricted = capability({
      complianceStatus: 'RESTRICTED',
      restrictionJson: { allowedUntil: '2026-06-01T00:00:00.000Z' },
    });

    expect(isOrderable(restricted, { at: new Date('2026-05-01T00:00:00.000Z') })).toBe(true);
    expect(isOrderable(restricted, { at: new Date('2026-07-01T00:00:00.000Z') })).toBe(false);
  });
});

describe('compliance restriction', () => {
  it('normalizes codes and requires at least one dimension', () => {
    expect(
      normalizeRestriction({ allowedCityCodes: ['beijing', 'BEIJING', ' shanghai '] }),
    ).toEqual({ allowedCityCodes: ['BEIJING', 'SHANGHAI'] });

    expect(() => normalizeRestriction({})).toThrow(/at least one of/);
    expect(() => normalizeRestriction({ allowedSubjectCodes: [] })).toThrow(/at least one of/);
  });

  it('rejects malformed payloads', () => {
    expect(() => normalizeRestriction({ allowedCityCodes: ['北京'] })).toThrow(/invalid code/);
    expect(() => normalizeRestriction({ allowedUntil: 'tomorrow' })).toThrow(/ISO-8601/);
  });

  it('reads stored json defensively', () => {
    expect(parseRestriction(null)).toBeNull();
    expect(parseRestriction({ allowedCityCodes: ['BEIJING'] })).toEqual({
      allowedCityCodes: ['BEIJING'],
    });
    expect(parseRestriction({})).toBeNull();
    expect(parseRestriction(['BEIJING'])).toBeNull();
    expect(parseRestriction({ allowedCityCodes: 'BEIJING' })).toBeNull();
  });

  it('applies allowlist semantics per dimension only', () => {
    const restriction = normalizeRestriction({ allowedSubjectCodes: ['MATH'] });

    expect(restrictionPermits(restriction, { subjectCodes: ['MATH'], cityCode: 'SHANGHAI' })).toBe(
      true,
    );
    expect(restrictionPermits(restriction, { cityCode: 'SHANGHAI' })).toBe(false);
    expect(restrictionPermits(null, { subjectCodes: ['MATH'] })).toBe(false);
  });
});
