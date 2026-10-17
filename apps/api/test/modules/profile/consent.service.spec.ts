import { beforeEach, describe, expect, it } from 'vitest';

import { ConsentService } from '../../../src/modules/profile/application/consent.service';
import { isActiveConsent } from '../../../src/modules/identity/domain/consent.model';
import { FakeChildProfileRepository, FakeConsentRepository } from './fakes';

const USER = 'user-1';

function build() {
  const children = new FakeChildProfileRepository();
  const consents = new FakeConsentRepository();
  return { service: new ConsentService(consents, children), children, consents };
}

describe('ConsentService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('records policy version, timestamp, actor and evidence', async () => {
    const consent = await context.service.grant(
      USER,
      { consentType: 'PRIVACY', policyVersion: '2026-09-01' },
      'request:req-42',
    );

    expect(consent.policyVersion).toBe('2026-09-01');
    expect(consent.userId).toBe(USER);
    expect(consent.granted).toBe(true);
    expect(consent.grantedAt).toBeInstanceOf(Date);
    expect(consent.evidenceRef).toBe('request:req-42');
    expect(isActiveConsent(consent)).toBe(true);
  });

  it('keeps history: a re-grant appends instead of overwriting', async () => {
    await context.service.grant(USER, { consentType: 'TERMS', policyVersion: 'v1' });
    await context.service.grant(USER, { consentType: 'TERMS', policyVersion: 'v2' });

    const history = await context.service.list(USER);
    expect(history).toHaveLength(2);
    expect(history[0]?.policyVersion).toBe('v2');

    const active = await context.consents.findActive(USER, 'TERMS');
    expect(active?.policyVersion).toBe('v2');
  });

  it('withdraws an active consent', async () => {
    await context.service.grant(USER, { consentType: 'MARKETING', policyVersion: 'v1' });

    const revoked = await context.service.revoke(USER, 'MARKETING');

    expect(revoked.revokedAt).not.toBeNull();
    expect(await context.consents.findActive(USER, 'MARKETING')).toBeNull();
  });

  it('fails withdrawal when there is no active consent', async () => {
    await expect(context.service.revoke(USER, 'MARKETING')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('mirrors guardian consent onto the child profiles', async () => {
    const child = await context.children.create({
      guardianUserId: USER,
      nickname: '小明',
      dataProcessingConsentStatus: 'PENDING',
    });

    await context.service.grant(USER, {
      consentType: 'MINOR_GUARDIAN',
      policyVersion: 'v1',
    });
    expect(context.children.children.get(child.id)?.dataProcessingConsentStatus).toBe('GRANTED');

    await context.service.revoke(USER, 'MINOR_GUARDIAN');
    expect(context.children.children.get(child.id)?.dataProcessingConsentStatus).toBe('REVOKED');

    await context.service.grant(USER, {
      consentType: 'MINOR_GUARDIAN',
      policyVersion: 'v2',
    });
    expect(context.children.children.get(child.id)?.dataProcessingConsentStatus).toBe('GRANTED');
  });

  it('does not touch child profiles for other consent types', async () => {
    const child = await context.children.create({
      guardianUserId: USER,
      nickname: '小明',
      dataProcessingConsentStatus: 'PENDING',
    });

    await context.service.grant(USER, { consentType: 'IM_POLICY', policyVersion: 'v1' });

    expect(context.children.children.get(child.id)?.dataProcessingConsentStatus).toBe('PENDING');
  });
});
