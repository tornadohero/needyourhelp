import { describe, expect, it } from 'vitest';

import type { ProviderProfile } from '../../../src/modules/provider/domain/provider-profile.model';
import {
  canPublish,
  canSubmit,
  canTransition,
  isDiscoverable,
  isEditable,
  PROVIDER_TRANSITIONS,
} from '../../../src/modules/provider/domain/provider-policy';

function profileWithStatus(status: ProviderProfile['approvalStatus']): ProviderProfile {
  return {
    id: 'provider-1',
    userId: 'user-1',
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: null,
    bio: null,
    avatarVisibility: 'PRIVATE',
    avatarAssetId: null,
    cityCode: null,
    serviceMode: 'ONLINE',
    approvalStatus: status,
    searchable: false,
    ratingAvg: null,
    ratingCount: 0,
    completedOrderCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('provider application state machine', () => {
  it('follows the spec transitions', () => {
    expect(PROVIDER_TRANSITIONS.DRAFT).toEqual(['SUBMITTED']);
    expect(PROVIDER_TRANSITIONS.SUBMITTED).toContain('UNDER_REVIEW');
    expect(PROVIDER_TRANSITIONS.UNDER_REVIEW).toEqual(['APPROVED', 'REJECTED']);
    expect(PROVIDER_TRANSITIONS.APPROVED).toEqual(['SUSPENDED']);
    expect(PROVIDER_TRANSITIONS.SUSPENDED).toEqual(['APPROVED']);
    expect(PROVIDER_TRANSITIONS.REJECTED).toEqual(['SUBMITTED']);
  });

  it('allows a rejection to be resubmitted but never self-approved', () => {
    expect(canTransition('REJECTED', 'SUBMITTED')).toBe(true);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('SUBMITTED', 'SUBMITTED')).toBe(false);
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false);
  });

  it('only lets the provider edit before review or after a rejection', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('REJECTED')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
    expect(isEditable('UNDER_REVIEW')).toBe(false);
    expect(isEditable('APPROVED')).toBe(false);
    expect(isEditable('SUSPENDED')).toBe(false);

    expect(canSubmit('DRAFT')).toBe(true);
    expect(canSubmit('REJECTED')).toBe(true);
    expect(canSubmit('UNDER_REVIEW')).toBe(false);
    expect(canSubmit('APPROVED')).toBe(false);
  });
});

describe('publication gate', () => {
  it('requires approval and an active account', () => {
    expect(canPublish(profileWithStatus('APPROVED'), true)).toBe(true);
    expect(canPublish(profileWithStatus('APPROVED'), false)).toBe(false);
  });

  it('rejects every non-approved status', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'] as const) {
      expect(canPublish(profileWithStatus(status), true)).toBe(false);
    }
  });
});

describe('discovery gate', () => {
  it('is discoverable only when every gate passes', () => {
    expect(
      isDiscoverable({
        accountActive: true,
        approvalStatus: 'APPROVED',
        verificationSatisfied: true,
        hasPublishedService: true,
      }),
    ).toBe(true);
  });

  it('stays hidden when any gate fails', () => {
    const base = {
      accountActive: true,
      approvalStatus: 'APPROVED' as const,
      verificationSatisfied: true,
      hasPublishedService: true,
    };

    expect(isDiscoverable({ ...base, accountActive: false })).toBe(false);
    expect(isDiscoverable({ ...base, approvalStatus: 'SUBMITTED' })).toBe(false);
    expect(isDiscoverable({ ...base, approvalStatus: 'SUSPENDED' })).toBe(false);
    expect(isDiscoverable({ ...base, verificationSatisfied: false })).toBe(false);
    expect(isDiscoverable({ ...base, hasPublishedService: false })).toBe(false);
  });
});
