import { beforeEach, describe, expect, it } from 'vitest';

import { ProviderAdminService } from '../../../src/modules/provider/application/provider-admin.service';
import { ProviderApplicationService } from '../../../src/modules/provider/application/provider-application.service';
import {
  FakeAuditLogRepository,
  FakeFeatureFlagRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  FakeProviderReadinessGates,
  TrackingUserRepository,
} from './fakes';

const ADMIN = 'admin-1';
const REQUEST_ID = 'req-42';

function build() {
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const users = new TrackingUserRepository();
  const audit = new FakeAuditLogRepository();
  const applications = new ProviderApplicationService(
    profiles,
    capabilities,
    new FakeFeatureFlagRepository(),
    new FakeProviderReadinessGates(),
    users,
  );
  const admin = new ProviderAdminService(profiles, capabilities, users, audit, applications);
  return { admin, applications, profiles, capabilities, users, audit };
}

async function submittedApplication(context: ReturnType<typeof build>): Promise<string> {
  const user = await context.users.create({ displayName: '申请人' });
  await context.applications.createApplication(user.id, {
    providerType: 'TUTORING',
    publicName: '李老师',
    capabilityTypes: ['STUDENT_TUTOR'],
  });
  const submitted = await context.applications.submitApplication(user.id);
  return submitted.profile.id;
}

describe('ProviderAdminService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('approves a submitted application and grants the provider role', async () => {
    const providerId = await submittedApplication(context);

    const application = await context.admin.approve(providerId, {
      actorUserId: ADMIN,
      requestId: REQUEST_ID,
    });

    expect(application.profile.approvalStatus).toBe('APPROVED');
    // Approval alone is not enough to be discoverable (T006/T009 gates).
    expect(application.profile.searchable).toBe(false);

    const roles = await context.users.listRoles(application.profile.userId);
    expect(roles).toContain('PROVIDER');
  });

  it('audits the approval with actor, request id and before/after snapshot', async () => {
    const providerId = await submittedApplication(context);

    await context.admin.approve(providerId, {
      actorUserId: ADMIN,
      reason: '材料齐全',
      requestId: REQUEST_ID,
      ipHash: 'ip-hash',
    });

    const decision = context.audit.find('PROVIDER_APPROVED');
    expect(decision?.actorUserId).toBe(ADMIN);
    expect(decision?.actorType).toBe('ADMIN');
    expect(decision?.requestId).toBe(REQUEST_ID);
    expect(decision?.ipHash).toBe('ip-hash');
    expect(decision?.beforeJson).toMatchObject({ approvalStatus: 'SUBMITTED' });
    expect(decision?.afterJson).toMatchObject({ approvalStatus: 'APPROVED' });

    // The role change is audited as its own privileged mutation.
    const roleGrant = context.audit.find('ROLE_GRANTED');
    expect(roleGrant?.resourceType).toBe('user_role');
    expect(roleGrant?.afterJson).toMatchObject({ roles: ['PROVIDER'] });
  });

  it('does not grant the provider role twice', async () => {
    const user = await context.users.create({ displayName: '申请人' });
    await context.applications.createApplication(user.id, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });
    const submitted = await context.applications.submitApplication(user.id);
    // The account already holds the role (e.g. seeded, or granted earlier).
    await context.users.addRole(user.id, 'PROVIDER');

    await context.admin.approve(submitted.profile.id, {
      actorUserId: ADMIN,
      requestId: REQUEST_ID,
    });

    expect(context.audit.rows.filter((row) => row.action === 'ROLE_GRANTED')).toHaveLength(0);
  });

  it('refuses to approve an application that is not under review', async () => {
    const user = await context.users.create({ displayName: '申请人' });
    const created = await context.applications.createApplication(user.id, {
      providerType: 'TUTORING',
      publicName: '李老师',
      capabilityTypes: ['STUDENT_TUTOR'],
    });

    await expect(
      context.admin.approve(created.profile.id, { actorUserId: ADMIN, requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('rejects with a reason and audits it', async () => {
    const providerId = await submittedApplication(context);

    const application = await context.admin.reject(providerId, {
      actorUserId: ADMIN,
      reason: '学历证明不清晰',
      requestId: REQUEST_ID,
    });

    expect(application.profile.approvalStatus).toBe('REJECTED');
    expect(context.audit.find('PROVIDER_REJECTED')?.afterJson).toMatchObject({
      reason: '学历证明不清晰',
    });
  });

  it('requires a reason to reject', async () => {
    const providerId = await submittedApplication(context);

    await expect(
      context.admin.reject(providerId, { actorUserId: ADMIN, requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      context.admin.reject(providerId, {
        actorUserId: ADMIN,
        reason: '   ',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(context.audit.find('PROVIDER_REJECTED')).toBeUndefined();
  });

  it('returns NOT_FOUND for an unknown provider', async () => {
    await expect(
      context.admin.approve('missing', { actorUserId: ADMIN, requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('suspends an approved provider, out of discovery, and audits it', async () => {
    const providerId = await submittedApplication(context);
    await context.admin.approve(providerId, { actorUserId: ADMIN, requestId: REQUEST_ID });

    const application = await context.admin.suspend(providerId, {
      actorUserId: ADMIN,
      reason: '多起投诉待查',
      requestId: REQUEST_ID,
    });

    expect(application.profile.approvalStatus).toBe('SUSPENDED');
    // A suspended provider must not keep being booked while the case is open.
    expect(application.profile.searchable).toBe(false);
    expect(context.audit.find('PROVIDER_SUSPENDED')).toMatchObject({
      actorUserId: ADMIN,
      requestId: REQUEST_ID,
    });
    expect(context.audit.find('PROVIDER_SUSPENDED')?.afterJson).toMatchObject({
      reason: '多起投诉待查',
    });
  });

  it('requires a reason to suspend, and refuses a provider that was never approved', async () => {
    const providerId = await submittedApplication(context);

    // `SUBMITTED -> SUSPENDED` is not a transition of the state machine.
    await expect(
      context.admin.suspend(providerId, {
        actorUserId: ADMIN,
        reason: '待查',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await context.admin.approve(providerId, { actorUserId: ADMIN, requestId: REQUEST_ID });
    await expect(
      context.admin.suspend(providerId, { actorUserId: ADMIN, requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(context.audit.find('PROVIDER_SUSPENDED')).toBeUndefined();
  });

  it('restores a suspended provider and re-reads every readiness gate', async () => {
    const providerId = await submittedApplication(context);
    await context.admin.approve(providerId, { actorUserId: ADMIN, requestId: REQUEST_ID });
    await context.admin.suspend(providerId, {
      actorUserId: ADMIN,
      reason: '待查',
      requestId: REQUEST_ID,
    });

    const application = await context.admin.restore(providerId, {
      actorUserId: ADMIN,
      requestId: REQUEST_ID,
    });

    expect(application.profile.approvalStatus).toBe('APPROVED');
    // Restoring does not publish the provider by itself: the gates decide.
    expect(application.profile.searchable).toBe(false);
    expect(context.audit.find('PROVIDER_RESTORED')).toMatchObject({ actorUserId: ADMIN });
  });
});
