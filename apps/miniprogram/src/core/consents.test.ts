import type { ConsentResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import { consentLabel, describeConsent, describeConsents, isActive } from './consents';

function consent(overrides: Partial<ConsentResponse> = {}): ConsentResponse {
  return {
    id: 'consent-1',
    consentType: 'MINOR_GUARDIAN',
    policyVersion: 'v1',
    granted: true,
    grantedAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

describe('isActive', () => {
  it('is true only while granted and not withdrawn', () => {
    expect(isActive(consent())).toBe(true);
  });

  it('is false once withdrawn, even though `granted` stays true', () => {
    // The history keeps `granted: true` forever: revokedAt is what counts.
    expect(isActive(consent({ revokedAt: '2026-02-01T00:00:00.000Z' }))).toBe(false);
  });

  it('is false for a row that was never granted', () => {
    expect(isActive(consent({ granted: false }))).toBe(false);
  });
});

describe('describeConsent', () => {
  it('labels the type the platform defines', () => {
    expect(describeConsent(consent()).label).toBe('未成年人监护人同意');
    expect(consentLabel('PRIVACY')).toBe('隐私政策');
  });

  it('keeps the policy version that was shown when it was granted', () => {
    expect(describeConsent(consent({ policyVersion: 'v3' })).policyVersion).toBe('v3');
  });
});

describe('describeConsents', () => {
  it('sorts newest first so a withdrawal sits next to its grant', () => {
    const views = describeConsents({
      consents: [
        consent({ id: 'old', grantedAt: '2026-01-01T00:00:00.000Z' }),
        consent({
          id: 'new',
          grantedAt: '2026-06-01T00:00:00.000Z',
          revokedAt: '2026-06-02T00:00:00.000Z',
        }),
      ],
    });

    expect(views.map((view) => view.grantedAt)).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(views[0]?.active).toBe(false);
  });

  it('answers an empty history without inventing a consent', () => {
    expect(describeConsents({ consents: [] })).toEqual([]);
  });
});
