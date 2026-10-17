import { afterAll, beforeAll, expect, it } from 'vitest';

import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { PrismaVerificationCaseRepository } from '../../src/modules/verification/infrastructure/prisma-verification-case.repository';
import { PrismaVerificationReadiness } from '../../src/modules/verification/infrastructure/prisma-verification-readiness';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase, fixtureKey } from './helpers/test-database';

/**
 * Repository behaviour for the T006 tables against a real PostgreSQL database
 * (`specs/04-database-spec.md` §verification_cases / §verification_documents).
 * No schema change: T006 reuses the T002 design as-is.
 */
describeWithDatabase('verification repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let cases: PrismaVerificationCaseRepository;
  let readiness: PrismaVerificationReadiness;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    cases = new PrismaVerificationCaseRepository(prisma);
    readiness = new PrismaVerificationReadiness(prisma);
  });

  afterAll(async () => {
    await prisma.verificationDocument.deleteMany({
      where: { verificationCase: { provider: { userId: { in: userIds } } } },
    });
    await prisma.verificationCase.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { resourceType: 'verification_case' } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /** Creates an account with a tutoring provider application. */
  async function newProvider(): Promise<{ providerId: string; userId: string }> {
    const user = await new PrismaUserRepository(prisma).create({
      displayName: fixtureKey('t006'),
    });
    userIds.push(user.id);
    const profile = await new PrismaProviderProfileRepository(prisma).create({
      userId: user.id,
      providerType: 'TUTORING',
      publicName: fixtureKey('provider'),
    });
    return { providerId: profile.id, userId: user.id };
  }

  it('creates a case as a draft and finds it per provider and type', async () => {
    const { providerId } = await newProvider();

    const created = await cases.create({ providerId, verificationType: 'IDENTITY' });

    expect(created.status).toBe('DRAFT');
    expect(created.submittedAt).toBeNull();
    expect((await cases.findById(created.id))?.id).toBe(created.id);
    expect((await cases.findByProviderAndType(providerId, 'IDENTITY'))?.id).toBe(created.id);
    expect(await cases.findByProviderAndType(providerId, 'EDUCATION')).toBeNull();
    expect(await cases.listByProvider(providerId)).toHaveLength(1);
  });

  it('records an explicit decision on the case', async () => {
    const { providerId, userId } = await newProvider();
    const created = await cases.create({ providerId, verificationType: 'IDENTITY' });

    const submitted = await cases.update(created.id, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });
    const approved = await cases.update(created.id, {
      status: 'APPROVED',
      reviewedAt: new Date(),
      // `reviewer_id` is a user FK: only an account can review a case.
      reviewerId: userId,
      decisionReason: 'DOCUMENT_VERIFIED',
      evidenceRef: 'request:req-1',
    });

    expect(submitted.status).toBe('SUBMITTED');
    expect(approved.status).toBe('APPROVED');
    expect(approved.decisionReason).toBe('DOCUMENT_VERIFIED');
    expect(approved.evidenceRef).toBe('request:req-1');
    expect(approved.reviewedAt).not.toBeNull();
  });

  it('stores documents with a private key and a hash', async () => {
    const { providerId } = await newProvider();
    const created = await cases.create({ providerId, verificationType: 'IDENTITY' });

    const document = await cases.addDocument({
      caseId: created.id,
      documentType: 'ID_CARD',
      storageKey: `verification/${created.id}/object`,
      fileHash: 'a'.repeat(64),
      encryptedMetadata: 'sealed-blob',
      expiresAt: new Date(),
    });

    expect(await cases.listDocuments(created.id)).toHaveLength(1);
    expect((await cases.findDocumentById(document.id))?.storageKey).toBe(
      `verification/${created.id}/object`,
    );
    expect((await cases.findDocumentById(document.id))?.fileHash).toBe('a'.repeat(64));
  });

  it('lists the queue newest first, filtered and bounded', async () => {
    const { providerId } = await newProvider();
    const older = await cases.create({ providerId, verificationType: 'IDENTITY' });
    // `created_at` has millisecond resolution: step past it so that "newest
    // first" is unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await cases.create({ providerId, verificationType: 'EDUCATION' });
    await cases.update(newer.id, { status: 'SUBMITTED' });

    const all = await cases.listQueue({ limit: 10 });
    const mine = all.filter((item) => item.providerId === providerId);
    expect(mine[0]?.id).toBe(newer.id);
    expect(mine[1]?.id).toBe(older.id);

    const filtered = await cases.listQueue({ status: ['SUBMITTED'], limit: 10 });
    expect(filtered.some((item) => item.id === newer.id)).toBe(true);
    expect(filtered.some((item) => item.id === older.id)).toBe(false);

    expect(await cases.listQueue({ limit: 1 })).toHaveLength(1);
  });

  it('satisfies the discovery gate only when identity and education are approved', async () => {
    const { providerId } = await newProvider();

    expect(await readiness.isSatisfied(providerId)).toBe(false);

    const identity = await cases.create({ providerId, verificationType: 'IDENTITY' });
    await cases.update(identity.id, { status: 'APPROVED' });
    expect(await readiness.isSatisfied(providerId)).toBe(false);

    const education = await cases.create({ providerId, verificationType: 'EDUCATION' });
    await cases.update(education.id, { status: 'APPROVED' });
    expect(await readiness.isSatisfied(providerId)).toBe(true);

    await cases.update(education.id, { status: 'REJECTED' });
    expect(await readiness.isSatisfied(providerId)).toBe(false);
  });
});
