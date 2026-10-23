import { beforeEach, describe, expect, it } from 'vitest';

import { VerificationService } from '../../../src/modules/verification/application/verification.service';
import { DEFAULT_DOCUMENT_MAX_BYTES } from '../../../src/modules/verification/domain/verification-document-policy';
import {
  FakeProviderCapabilityRepository,
  FakeProviderProfileRepository,
  TrackingUserRepository,
} from '../provider/fakes';
import {
  FILE_HASH,
  FakeDocumentMetadataCipher,
  FakeObjectStorageGateway,
  FakeVerificationCaseRepository,
} from './fakes';

function build() {
  const cases = new FakeVerificationCaseRepository();
  const profiles = new FakeProviderProfileRepository();
  const capabilities = new FakeProviderCapabilityRepository();
  const storage = new FakeObjectStorageGateway();
  const cipher = new FakeDocumentMetadataCipher();
  const users = new TrackingUserRepository();
  const service = new VerificationService(
    cases,
    profiles,
    storage,
    cipher,
    DEFAULT_DOCUMENT_MAX_BYTES,
  );
  return { service, cases, profiles, capabilities, storage, cipher, users };
}

type Context = ReturnType<typeof build>;

/** Register an account with a tutoring provider application. */
async function newProvider(context: Context, publicName = '李老师'): Promise<string> {
  const user = await context.users.create({ displayName: publicName });
  await context.profiles.create({
    userId: user.id,
    providerType: 'TUTORING',
    publicName,
  });
  return user.id;
}

const IDENTITY_DOCUMENT = {
  documentType: 'ID_CARD' as const,
  contentType: 'image/jpeg',
  byteSize: 2048,
  fileHash: FILE_HASH,
};

describe('VerificationService', () => {
  let context: Context;

  beforeEach(() => {
    context = build();
  });

  it('creates a draft case for the caller provider', async () => {
    const userId = await newProvider(context);

    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    expect(created.status).toBe('DRAFT');
    expect(created.verificationType).toBe('IDENTITY');
    expect(created.submittedAt).toBeNull();
  });

  it('refuses a case for an account without a provider application', async () => {
    const user = await context.users.create({ displayName: '路人' });

    await expect(
      context.service.createCase(user.id, { verificationType: 'IDENTITY' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('keeps one case per provider and type', async () => {
    const userId = await newProvider(context);
    await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    await expect(
      context.service.createCase(userId, { verificationType: 'IDENTITY' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('issues an upload URL with a server-generated private key', async () => {
    const userId = await newProvider(context);
    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    const { document, upload } = await context.service.requestUploadUrl(userId, created.id, {
      ...IDENTITY_DOCUMENT,
      filename: 'id-card.jpg',
    });

    expect(upload.method).toBe('PUT');
    expect(upload.url).toContain(document.storageKey);
    expect(document.storageKey.startsWith(`verification/${created.id}/`)).toBe(true);
    expect(document.fileHash).toBe(FILE_HASH);
    // Metadata is sealed, never stored in the clear.
    expect(document.encryptedMetadata).toBe(
      `sealed:${JSON.stringify({
        filename: 'id-card.jpg',
        contentType: 'image/jpeg',
        byteSize: 2048,
      })}`,
    );
    expect(context.storage.uploads[0]?.key).toBe(document.storageKey);
  });

  it('accepts an upload without a file hash: the server records it from the bytes', async () => {
    const userId = await newProvider(context);
    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    // A WeChat mini program cannot compute SHA-256, so the hash is optional and
    // the document stays unhashed until the object arrives.
    const { document } = await context.service.requestUploadUrl(userId, created.id, {
      documentType: 'ID_CARD',
      contentType: 'image/jpeg',
      byteSize: 2048,
    });

    expect(document.fileHash).toBeNull();

    const recorded = await context.cases.setDocumentFileHash(document.id, 'a'.repeat(64));
    expect(recorded).toBe(true);
    // The first upload is the one the hash describes: a second write is ignored.
    expect(await context.cases.setDocumentFileHash(document.id, 'b'.repeat(64))).toBe(false);
  });

  it('refuses disallowed content types and over-sized files', async () => {
    const userId = await newProvider(context);
    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    await expect(
      context.service.requestUploadUrl(userId, created.id, {
        ...IDENTITY_DOCUMENT,
        contentType: 'application/x-msdownload',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      context.service.requestUploadUrl(userId, created.id, {
        ...IDENTITY_DOCUMENT,
        byteSize: DEFAULT_DOCUMENT_MAX_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      context.service.requestUploadUrl(userId, created.id, {
        ...IDENTITY_DOCUMENT,
        fileHash: 'not-a-hash',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(context.storage.uploads).toHaveLength(0);
  });

  it('refuses evidence once the case is under review', async () => {
    const userId = await newProvider(context);
    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });
    await context.cases.forceStatus(created.id, 'SUBMITTED');

    await expect(
      context.service.requestUploadUrl(userId, created.id, IDENTITY_DOCUMENT),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('never lets a provider touch another provider case', async () => {
    const owner = await newProvider(context, '老师A');
    const stranger = await newProvider(context, '老师B');
    const created = await context.service.createCase(owner, { verificationType: 'IDENTITY' });

    await expect(
      context.service.requestUploadUrl(stranger, created.id, IDENTITY_DOCUMENT),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(context.service.submitCase(stranger, created.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await expect(context.service.submitCase(owner, 'missing-case')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('submits only with evidence, and resubmits a rejection', async () => {
    const userId = await newProvider(context);
    const created = await context.service.createCase(userId, { verificationType: 'IDENTITY' });

    await expect(context.service.submitCase(userId, created.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await context.service.requestUploadUrl(userId, created.id, IDENTITY_DOCUMENT);
    const submitted = await context.service.submitCase(userId, created.id);
    expect(submitted.case.status).toBe('SUBMITTED');
    expect(submitted.case.submittedAt).not.toBeNull();

    await expect(context.service.submitCase(userId, created.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await context.cases.forceStatus(created.id, 'REJECTED');
    const resubmitted = await context.service.submitCase(userId, created.id);
    expect(resubmitted.case.status).toBe('RESUBMITTED');
  });

  it('lists only the caller own cases with document metadata', async () => {
    const owner = await newProvider(context, '老师A');
    const stranger = await newProvider(context, '老师B');

    const identity = await context.service.createCase(owner, { verificationType: 'IDENTITY' });
    await context.service.createCase(owner, { verificationType: 'EDUCATION' });
    await context.service.requestUploadUrl(owner, identity.id, IDENTITY_DOCUMENT);

    const mine = await context.service.listMyCases(owner);
    expect(mine.views).toHaveLength(2);
    expect(mine.views[0]?.documents).toHaveLength(1);

    const theirs = await context.service.listMyCases(stranger);
    expect(theirs.views).toHaveLength(0);
    expect(theirs.providerId).not.toBe(mine.providerId);
  });
});
