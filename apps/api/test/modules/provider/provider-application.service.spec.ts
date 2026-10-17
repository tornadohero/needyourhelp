import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityType } from '../../../src/modules/provider/domain/provider-profile.model';
import { ProviderApplicationService } from '../../../src/modules/provider/application/provider-application.service';
import {
  FakeFeatureFlagRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  FakeProviderReadinessGates,
  TrackingUserRepository,
} from './fakes';

interface BuildOptions {
  careerEnabled?: boolean;
  verificationSatisfied?: boolean;
  hasPublishedService?: boolean;
}

function build(options: BuildOptions = {}) {
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const flags = new FakeFeatureFlagRepository({
    career_marketplace_enabled: options.careerEnabled === true,
  });
  const gates = new FakeProviderReadinessGates({
    verificationSatisfied: options.verificationSatisfied,
    hasPublishedService: options.hasPublishedService,
  });
  const users = new TrackingUserRepository();
  const service = new ProviderApplicationService(profiles, capabilities, flags, gates, users);
  return { service, profiles, capabilities, users, flags };
}

async function newUser(context: ReturnType<typeof build>): Promise<string> {
  const user = await context.users.create({ displayName: '申请人' });
  return user.id;
}

describe('ProviderApplicationService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('creates a draft application with its capabilities', async () => {
    const userId = await newUser(context);

    const application = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      headline: '数学辅导',
      capabilityTypes: ['STUDENT_TUTOR', 'TEACHER'],
    });

    expect(application.profile.approvalStatus).toBe('DRAFT');
    expect(application.profile.searchable).toBe(false);
    expect(application.profile.avatarVisibility).toBe('PRIVATE');
    expect(application.capabilities).toHaveLength(2);
    expect(application.capabilities[0]?.status).toBe('DRAFT');
    expect(application.capabilities[0]?.verificationLevel).toBe('NONE');
  });

  it('starts teacher capabilities in compliance review', async () => {
    const userId = await newUser(context);

    const application = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '王老师',
      capabilityTypes: ['TEACHER', 'GRADUATE_TUTOR'],
    });

    const teacher = application.capabilities.find((c) => c.capabilityType === 'TEACHER');
    const tutor = application.capabilities.find((c) => c.capabilityType === 'GRADUATE_TUTOR');
    expect(teacher?.complianceStatus).toBe('PENDING');
    expect(tutor?.complianceStatus).toBe('NOT_REQUIRED');
  });

  it('deduplicates capability types and rejects empty sets', async () => {
    const userId = await newUser(context);

    const application = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR', 'STUDENT_TUTOR'],
    });
    expect(application.capabilities).toHaveLength(1);

    await expect(
      context.service.createApplication(await newUser(context), {
        providerType: 'TUTORING',
        publicName: 'x',
        capabilityTypes: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects a capability from another domain', async () => {
    const userId = await newUser(context);

    await expect(
      context.service.createApplication(userId, {
        providerType: 'TUTORING',
        publicName: '李老师',
        capabilityTypes: ['CAREER_MENTOR' as CapabilityType],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('blocks career applications while the marketplace is flagged off', async () => {
    const userId = await newUser(context);

    await expect(
      context.service.createApplication(userId, {
        providerType: 'CAREER',
        publicName: '职业导师',
        capabilityTypes: ['CAREER_MENTOR'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const enabled = build({ careerEnabled: true });
    const careerUser = await newUser(enabled);
    const application = await enabled.service.createApplication(careerUser, {
      providerType: 'CAREER',
      publicName: '职业导师',
      capabilityTypes: ['CAREER_MENTOR'],
    });
    expect(application.profile.providerType).toBe('CAREER');
  });

  it('closes every career entry point while the marketplace is flagged off', async () => {
    const context = build({ careerEnabled: true });
    const careerUser = await newUser(context);
    await context.service.createApplication(careerUser, {
      providerType: 'CAREER',
      publicName: '职业导师',
      capabilityTypes: ['CAREER_MENTOR'],
    });
    const tutor = await newUser(context);
    await context.service.createApplication(tutor, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    // The flag is switched off after the mentor already applied (T021): the
    // mentor can no longer submit and can no longer publish.
    context.flags.flags.career_marketplace_enabled = false;

    await expect(context.service.submitApplication(careerUser, 'CAREER')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(context.service.assertCanPublish(careerUser, 'CAREER')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // The tutoring marketplace is untouched by the career flag.
    await expect(context.service.submitApplication(tutor)).resolves.toBeDefined();
  });

  it('never leaves a career provider searchable while the marketplace is off', async () => {
    const enabled = build({
      careerEnabled: true,
      verificationSatisfied: true,
      hasPublishedService: true,
    });
    const userId = await newUser(enabled);
    const application = await enabled.service.createApplication(userId, {
      providerType: 'CAREER',
      publicName: '职业导师',
      capabilityTypes: ['CAREER_MENTOR'],
    });
    await enabled.profiles.setApprovalStatus(application.profile.id, 'APPROVED');
    const approved = await enabled.service.getMyApplication(userId, 'CAREER');

    // Every gate passes, but the marketplace is switched off.
    const closed = build({
      careerEnabled: false,
      verificationSatisfied: true,
      hasPublishedService: true,
    });
    const hidden = await closed.service.refreshSearchable(approved.profile);
    expect(hidden.searchable).toBe(false);

    // Switching it back on makes the same provider discoverable again.
    const reopened = await enabled.service.refreshSearchable(approved.profile);
    expect(reopened.searchable).toBe(true);
  });

  it('accepts one application per account and provider type', async () => {
    const userId = await newUser(context);

    await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    await expect(
      context.service.createApplication(userId, {
        providerType: 'TUTORING',
        publicName: '李老师',
        capabilityTypes: ['STUDENT_TUTOR'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects applications from suspended accounts', async () => {
    const userId = await newUser(context);
    await context.users.setStatus(userId, 'SUSPENDED');

    await expect(
      context.service.createApplication(userId, {
        providerType: 'TUTORING',
        publicName: '李老师',
        capabilityTypes: ['STUDENT_TUTOR'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns NOT_FOUND when the account has no application', async () => {
    const userId = await newUser(context);

    await expect(context.service.getMyApplication(userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('edits a draft application and replaces its capabilities', async () => {
    const userId = await newUser(context);
    await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    const updated = await context.service.updateMyApplication(userId, {
      publicName: '李老师（高级）',
      cityCode: 'BEIJING',
      capabilityTypes: ['GRADUATE_TUTOR', 'PHD_TUTOR'],
    });

    expect(updated.profile.publicName).toBe('李老师（高级）');
    expect(updated.profile.cityCode).toBe('BEIJING');
    expect(updated.capabilities.map((c) => c.capabilityType)).toEqual([
      'GRADUATE_TUTOR',
      'PHD_TUTOR',
    ]);
  });

  it('refuses edits once the application is under review', async () => {
    const userId = await newUser(context);
    await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    await context.service.submitApplication(userId);

    await expect(
      context.service.updateMyApplication(userId, { publicName: '改名' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('submits, then refuses a second submission', async () => {
    const userId = await newUser(context);
    await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    const submitted = await context.service.submitApplication(userId);
    expect(submitted.profile.approvalStatus).toBe('SUBMITTED');

    await expect(context.service.submitApplication(userId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('allows resubmission after a rejection', async () => {
    const userId = await newUser(context);
    const created = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    await context.profiles.setApprovalStatus(created.profile.id, 'REJECTED');

    const resubmitted = await context.service.submitApplication(userId);
    expect(resubmitted.profile.approvalStatus).toBe('SUBMITTED');
  });

  it('requires a public name and a capability before submitting', async () => {
    const userId = await newUser(context);
    const created = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    await expect(context.service.submitApplication(userId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(created.profile.id).toBeDefined();
  });

  it('blocks publishing until the provider is approved', async () => {
    const userId = await newUser(context);
    await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    await expect(context.service.assertCanPublish(userId)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
      status: 409,
    });

    await context.service.submitApplication(userId);
    await expect(context.service.assertCanPublish(userId)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
    });

    const mine = await context.service.getMyApplication(userId);
    await context.profiles.setApprovalStatus(mine.profile.id, 'APPROVED');
    await expect(context.service.assertCanPublish(userId)).resolves.toBeDefined();
  });

  it('blocks publishing when the account is suspended', async () => {
    const userId = await newUser(context);
    const created = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    await context.profiles.setApprovalStatus(created.profile.id, 'APPROVED');
    await context.users.setStatus(userId, 'SUSPENDED');

    await expect(context.service.assertCanPublish(userId)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
    });
  });

  it('keeps searchable false until every readiness gate passes', async () => {
    const userId = await newUser(context);
    const created = await context.service.createApplication(userId, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    const approved = await context.profiles.setApprovalStatus(created.profile.id, 'APPROVED');

    const deferred = await context.service.refreshSearchable(approved);
    expect(deferred.searchable).toBe(false);

    const ready = build({ verificationSatisfied: true, hasPublishedService: true });
    const readyUser = await newUser(ready);
    const readyApplication = await ready.service.createApplication(readyUser, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    const readyApproved = await ready.profiles.setApprovalStatus(
      readyApplication.profile.id,
      'APPROVED',
    );

    const searchable = await ready.service.refreshSearchable(readyApproved);
    expect(searchable.searchable).toBe(true);
  });
});
