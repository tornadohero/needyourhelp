import { beforeEach, describe, expect, it } from 'vitest';

import { ProviderApplicationService } from '../../../src/modules/provider/application/provider-application.service';
import { VerificationAdminService } from '../../../src/modules/verification/application/verification-admin.service';
import {
  FakeAuditLogRepository,
  FakeFeatureFlagRepository,
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  FakeProviderReadinessGates,
  TrackingUserRepository,
} from '../provider/fakes';
import { FILE_HASH, FakeObjectStorageGateway, FakeVerificationCaseRepository } from './fakes';

const ADMIN = 'admin-1';
const REQUEST_ID = 'req-77';

interface BuildOptions {
  verificationSatisfied?: boolean;
  hasPublishedService?: boolean;
}

function build(options: BuildOptions = {}) {
  const cases = new FakeVerificationCaseRepository();
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const audit = new FakeAuditLogRepository();
  const storage = new FakeObjectStorageGateway();
  const users = new TrackingUserRepository();
  const applications = new ProviderApplicationService(
    profiles,
    capabilities,
    new FakeFeatureFlagRepository(),
    new FakeProviderReadinessGates({
      verificationSatisfied: options.verificationSatisfied,
      hasPublishedService: options.hasPublishedService,
    }),
    users,
  );
  const admin = new VerificationAdminService(
    cases,
    profiles,
    capabilities,
    audit,
    storage,
    applications,
  );
  return { admin, cases, profiles, capabilities, audit, storage, users, applications };
}

type Context = ReturnType<typeof build>;

/** A provider with an approved application, one capability and a submitted case. */
async function submittedCase(
  context: Context,
  verificationType: 'IDENTITY' | 'EDUCATION' = 'IDENTITY',
) {
  const user = await context.users.create({ displayName: '李老师' });
  const profile = await context.profiles.create({
    userId: user.id,
    providerType: 'TUTORING',
    publicName: '李老师',
  });
  await context.capabilities.createMany([
    { providerId: profile.id, capabilityType: 'STUDENT_TUTOR' },
  ]);
  await context.profiles.setApprovalStatus(profile.id, 'APPROVED');

  const created = await context.cases.create({
    providerId: profile.id,
    verificationType,
  });
  await context.cases.update(created.id, { status: 'SUBMITTED', submittedAt: new Date() });
  await context.cases.addDocument({
    caseId: created.id,
    documentType: verificationType === 'IDENTITY' ? 'ID_CARD' : 'DIPLOMA',
    storageKey: `verification/${created.id}/doc`,
    fileHash: FILE_HASH,
  });

  return { caseId: created.id, providerId: profile.id, userId: user.id };
}

describe('VerificationAdminService', () => {
  let context: Context;

  beforeEach(() => {
    context = build();
  });

  it('approves a submitted case and records the reviewer', async () => {
    const { caseId } = await submittedCase(context);

    const approved = await context.admin.approve(caseId, {
      actorUserId: ADMIN,
      reasonCode: 'DOCUMENT_VERIFIED',
      requestId: REQUEST_ID,
    });

    expect(approved.status).toBe('APPROVED');
    expect(approved.decisionReason).toBe('DOCUMENT_VERIFIED');
    expect(approved.documentCount).toBe(1);

    const stored = await context.cases.findById(caseId);
    expect(stored?.reviewerId).toBe(ADMIN);
    expect(stored?.reviewedAt).not.toBeNull();
    expect(stored?.evidenceRef).toBe(`request:${REQUEST_ID}`);
  });

  it('audits the approval with actor, reason and before/after snapshot', async () => {
    const { caseId } = await submittedCase(context);

    await context.admin.approve(caseId, {
      actorUserId: ADMIN,
      reasonCode: 'DOCUMENT_VERIFIED',
      notes: '证件清晰',
      requestId: REQUEST_ID,
      ipHash: 'ip-hash',
    });

    const row = context.audit.find('VERIFICATION_APPROVED');
    expect(row?.actorUserId).toBe(ADMIN);
    expect(row?.actorType).toBe('ADMIN');
    expect(row?.resourceType).toBe('verification_case');
    expect(row?.resourceId).toBe(caseId);
    expect(row?.requestId).toBe(REQUEST_ID);
    expect(row?.ipHash).toBe('ip-hash');
    expect(row?.beforeJson).toMatchObject({ status: 'SUBMITTED' });
    expect(row?.afterJson).toMatchObject({ status: 'APPROVED', notes: '证件清晰' });
  });

  it('requires a reason code for both decisions', async () => {
    const { caseId } = await submittedCase(context);

    await expect(
      context.admin.approve(caseId, {
        actorUserId: ADMIN,
        reasonCode: '  ',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    await expect(
      context.admin.reject(caseId, { actorUserId: ADMIN, reasonCode: '', requestId: REQUEST_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(context.audit.rows).toHaveLength(0);
  });

  it('rejects with an audit row and lets the provider resubmit', async () => {
    const { caseId } = await submittedCase(context);

    const rejected = await context.admin.reject(caseId, {
      actorUserId: ADMIN,
      reasonCode: 'FAKE_CREDENTIALS',
      requestId: REQUEST_ID,
    });

    expect(rejected.status).toBe('REJECTED');
    expect(context.audit.find('VERIFICATION_REJECTED')?.afterJson).toMatchObject({
      status: 'REJECTED',
    });
  });

  it('refuses to decide a case that is not awaiting review', async () => {
    const { caseId } = await submittedCase(context);
    await context.cases.forceStatus(caseId, 'DRAFT');

    await expect(
      context.admin.approve(caseId, {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns NOT_FOUND for an unknown case', async () => {
    await expect(
      context.admin.approve('missing', {
        actorUserId: ADMIN,
        reasonCode: 'OK',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('mirrors the verification outcome onto the capability level', async () => {
    const { caseId, providerId } = await submittedCase(context);

    await context.admin.approve(caseId, {
      actorUserId: ADMIN,
      reasonCode: 'DOCUMENT_VERIFIED',
      requestId: REQUEST_ID,
    });

    const [capability] = await context.capabilities.listByProvider(providerId);
    expect(capability?.verificationLevel).toBe('IDENTITY');

    // Education approval on top of identity lifts the level to FULL.
    const education = await context.cases.create({
      providerId,
      verificationType: 'EDUCATION',
    });
    await context.cases.update(education.id, { status: 'SUBMITTED' });
    await context.admin.approve(education.id, {
      actorUserId: ADMIN,
      reasonCode: 'DIPLOMA_VERIFIED',
      requestId: REQUEST_ID,
    });

    const [updated] = await context.capabilities.listByProvider(providerId);
    expect(updated?.verificationLevel).toBe('FULL');
  });

  it('keeps verification separate from provider approval for discoverability', async () => {
    const ready = build({ verificationSatisfied: true, hasPublishedService: true });
    const { caseId, providerId } = await submittedCase(ready);

    await ready.admin.approve(caseId, {
      actorUserId: ADMIN,
      reasonCode: 'DOCUMENT_VERIFIED',
      requestId: REQUEST_ID,
    });

    const profile = await ready.profiles.findById(providerId);
    expect(profile?.searchable).toBe(true);

    // With no published service the approved provider stays hidden.
    const { caseId: hiddenCase, providerId: hiddenProvider } = await submittedCase(context);
    await context.admin.approve(hiddenCase, {
      actorUserId: ADMIN,
      reasonCode: 'DOCUMENT_VERIFIED',
      requestId: REQUEST_ID,
    });
    expect((await context.profiles.findById(hiddenProvider))?.searchable).toBe(false);
  });

  it('issues an audited, short-lived URL for a private document', async () => {
    const { caseId } = await submittedCase(context);
    const [document] = await context.cases.listDocuments(caseId);

    const { download } = await context.admin.createDocumentAccessUrl(caseId, document?.id ?? '', {
      actorUserId: ADMIN,
      reasonCode: 'REVIEW',
      requestId: REQUEST_ID,
    });

    expect(download.url).toContain(document?.storageKey ?? '');
    expect(download.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(context.storage.downloads).toEqual([document?.storageKey]);

    const row = context.audit.find('VERIFICATION_DOCUMENT_ACCESSED');
    expect(row?.resourceType).toBe('verification_document');
    expect(row?.resourceId).toBe(document?.id);
    expect(row?.afterJson).toMatchObject({ reasonCode: 'REVIEW' });
  });

  it('refuses document access across cases', async () => {
    const { caseId } = await submittedCase(context);
    const otherCase = await context.cases.create({
      providerId: 'another-provider',
      verificationType: 'IDENTITY',
    });
    await context.cases.addDocument({
      caseId: otherCase.id,
      documentType: 'ID_CARD',
      storageKey: `verification/${otherCase.id}/doc`,
      fileHash: FILE_HASH,
    });
    const [foreign] = await context.cases.listDocuments(otherCase.id);
    const [mine] = await context.cases.listDocuments(caseId);

    // The document belongs to another case.
    await expect(
      context.admin.createDocumentAccessUrl(caseId, foreign?.id ?? '', {
        actorUserId: ADMIN,
        reasonCode: 'REVIEW',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // The case does not exist.
    await expect(
      context.admin.createDocumentAccessUrl('missing-case', mine?.id ?? '', {
        actorUserId: ADMIN,
        reasonCode: 'REVIEW',
        requestId: REQUEST_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(context.storage.downloads).toHaveLength(0);
  });

  it('lists the queue newest first', async () => {
    const first = await submittedCase(context);
    const second = await submittedCase(context);

    const items = await context.admin.listQueue({ limit: 10 });

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(second.caseId);
    expect(items[1]?.providerName).toBe('李老师');
    expect(first.caseId).toBeDefined();
  });
});
