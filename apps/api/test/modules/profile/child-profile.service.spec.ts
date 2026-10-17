import { beforeEach, describe, expect, it } from 'vitest';

import { ChildProfileService } from '../../../src/modules/profile/application/child-profile.service';
import { ConsentService } from '../../../src/modules/profile/application/consent.service';
import { FakeChildProfileRepository, FakeConsentRepository } from './fakes';

const GUARDIAN_A = 'guardian-a';
const GUARDIAN_B = 'guardian-b';

function build() {
  const children = new FakeChildProfileRepository();
  const consents = new FakeConsentRepository();
  const consentService = new ConsentService(consents, children);
  const service = new ChildProfileService(children, consents, consentService);
  return { service, consentService, children, consents };
}

describe('ChildProfileService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('creates a child profile and captures guardian consent with its version', async () => {
    const child = await context.service.create(
      GUARDIAN_A,
      { nickname: '小明', gradeCode: 'GRADE_5', consentPolicyVersion: '2026-09-01' },
      'request:req-1',
    );

    expect(child.guardianUserId).toBe(GUARDIAN_A);
    expect(child.dataProcessingConsentStatus).toBe('GRANTED');

    const consent = await context.consents.findActive(GUARDIAN_A, 'MINOR_GUARDIAN');
    expect(consent?.policyVersion).toBe('2026-09-01');
    expect(consent?.granted).toBe(true);
    expect(consent?.revokedAt).toBeNull();
    expect(consent?.evidenceRef).toBe('request:req-1');
  });

  it('rejects creation when no guardian consent exists', async () => {
    await expect(context.service.create(GUARDIAN_A, { nickname: '小明' })).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
      status: 403,
    });
  });

  it('accepts creation when consent was granted beforehand', async () => {
    await context.consentService.grant(GUARDIAN_A, {
      consentType: 'MINOR_GUARDIAN',
      policyVersion: '2026-09-01',
    });

    const child = await context.service.create(GUARDIAN_A, { nickname: '小明' });

    expect(child.dataProcessingConsentStatus).toBe('GRANTED');
    expect(context.consents.consents).toHaveLength(1);
  });

  it('lists only the guardian’s own, non-deleted children', async () => {
    const mine = await context.service.create(GUARDIAN_A, {
      nickname: '小明',
      consentPolicyVersion: 'v1',
    });
    await context.service.create(GUARDIAN_B, { nickname: '小红', consentPolicyVersion: 'v1' });
    await context.service.remove(GUARDIAN_A, mine.id);

    const list = await context.service.list(GUARDIAN_A);
    expect(list).toHaveLength(0);
    expect(await context.service.list(GUARDIAN_B)).toHaveLength(1);
    // The deleted row still exists: history must be preserved.
    expect(context.children.children.get(mine.id)?.deletedAt).not.toBeNull();
  });

  it('denies a non-guardian on read, update and delete', async () => {
    const child = await context.service.create(GUARDIAN_A, {
      nickname: '小明',
      consentPolicyVersion: 'v1',
    });

    await expect(context.service.get(GUARDIAN_B, child.id)).rejects.toMatchObject({
      code: 'CHILD_ACCESS_DENIED',
      status: 403,
    });
    await expect(
      context.service.update(GUARDIAN_B, child.id, { nickname: 'x' }),
    ).rejects.toMatchObject({ code: 'CHILD_ACCESS_DENIED' });
    await expect(context.service.remove(GUARDIAN_B, child.id)).rejects.toMatchObject({
      code: 'CHILD_ACCESS_DENIED',
    });
  });

  it('returns NOT_FOUND for an unknown or deleted child', async () => {
    await expect(context.service.get(GUARDIAN_A, 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });

    const child = await context.service.create(GUARDIAN_A, {
      nickname: '小明',
      consentPolicyVersion: 'v1',
    });
    await context.service.remove(GUARDIAN_A, child.id);

    await expect(context.service.get(GUARDIAN_A, child.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('updates a child profile while consent is active', async () => {
    const child = await context.service.create(GUARDIAN_A, {
      nickname: '小明',
      consentPolicyVersion: 'v1',
    });

    const updated = await context.service.update(GUARDIAN_A, child.id, {
      nickname: '小明明',
      gradeCode: 'GRADE_6',
    });

    expect(updated.nickname).toBe('小明明');
    expect(updated.gradeCode).toBe('GRADE_6');
  });

  it('blocks updates after consent withdrawal, but still allows deletion', async () => {
    const child = await context.service.create(GUARDIAN_A, {
      nickname: '小明',
      consentPolicyVersion: 'v1',
    });
    await context.consentService.revoke(GUARDIAN_A, 'MINOR_GUARDIAN');

    await expect(
      context.service.update(GUARDIAN_A, child.id, { nickname: 'x' }),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });

    // Deletion requests stay available (specs/10 §Export/deletion).
    await expect(context.service.remove(GUARDIAN_A, child.id)).resolves.toBe(child.id);
  });
});
