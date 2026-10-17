import { afterAll, beforeAll, expect, it } from 'vitest';

import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase, fixtureKey } from './helpers/test-database';

/**
 * Persistence of the T007 compliance state against a real PostgreSQL database
 * (`specs/04-database-spec.md` §provider_capabilities,
 * `specs/06-verification-state-machine.md` §Teacher compliance).
 *
 * The `restriction_json` column is added by
 * `prisma/migrations/20260929070000_teacher_compliance_restriction`.
 */
describeWithDatabase('compliance repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let capabilities: PrismaProviderCapabilityRepository;
  let profiles: PrismaProviderProfileRepository;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    capabilities = new PrismaProviderCapabilityRepository(prisma);
    profiles = new PrismaProviderProfileRepository(prisma);
  });

  afterAll(async () => {
    await prisma.providerCapability.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newProvider(publicName = fixtureKey('teacher')): Promise<string> {
    const user = await new PrismaUserRepository(prisma).create({ displayName: publicName });
    userIds.push(user.id);
    const profile = await profiles.create({
      userId: user.id,
      providerType: 'TUTORING',
      publicName,
    });
    return profile.id;
  }

  it('stores a compliance state without a restriction', async () => {
    const providerId = await newProvider();

    const [teacher] = await capabilities.createMany([
      { providerId, capabilityType: 'TEACHER', complianceStatus: 'PENDING' },
    ]);

    const stored = await capabilities.findById(teacher?.id ?? '');
    expect(stored?.complianceStatus).toBe('PENDING');
    expect(stored?.restrictionJson).toBeNull();
  });

  it('persists and clears a restriction scope', async () => {
    const providerId = await newProvider();
    const [teacher] = await capabilities.createMany([
      { providerId, capabilityType: 'TEACHER', complianceStatus: 'PENDING' },
    ]);
    const id = teacher?.id ?? '';

    const restricted = await capabilities.update(id, {
      complianceStatus: 'RESTRICTED',
      restrictionJson: {
        allowedSubjectCodes: ['MATH'],
        allowedCityCodes: ['BEIJING'],
        allowedUntil: '2026-12-31T00:00:00.000Z',
      },
    });

    expect(restricted.complianceStatus).toBe('RESTRICTED');
    expect(restricted.restrictionJson).toEqual({
      allowedSubjectCodes: ['MATH'],
      allowedCityCodes: ['BEIJING'],
      allowedUntil: '2026-12-31T00:00:00.000Z',
    });

    // An approval clears the scope: an approved capability is unrestricted.
    const approved = await capabilities.update(id, {
      complianceStatus: 'APPROVED',
      restrictionJson: null,
    });
    expect(approved.restrictionJson).toBeNull();
    expect((await capabilities.findById(id))?.restrictionJson).toBeNull();
  });

  it('keeps the restriction across a read of the whole capability set', async () => {
    const providerId = await newProvider();
    const [teacher] = await capabilities.createMany([
      { providerId, capabilityType: 'TEACHER', complianceStatus: 'RESTRICTED' },
    ]);
    await capabilities.update(teacher?.id ?? '', {
      restrictionJson: { allowedCityCodes: ['SHANGHAI'] },
    });

    const [stored] = await capabilities.listByProvider(providerId);
    expect(stored?.restrictionJson).toEqual({ allowedCityCodes: ['SHANGHAI'] });
  });

  it('lists the compliance queue by status and capability type', async () => {
    const first = await newProvider(fixtureKey('a'));
    const second = await newProvider(fixtureKey('b'));

    await capabilities.createMany([
      { providerId: first, capabilityType: 'TEACHER', complianceStatus: 'PENDING' },
      { providerId: first, capabilityType: 'GRADUATE_TUTOR', complianceStatus: 'NOT_REQUIRED' },
      { providerId: second, capabilityType: 'TEACHER', complianceStatus: 'UNDER_REVIEW' },
    ]);

    // Earlier cases in this file left capabilities behind, so every assertion is
    // scoped to the providers created here.
    const mine = [first, second];
    const forMine = <T extends { providerId: string }>(rows: T[]) =>
      rows.filter((row) => mine.includes(row.providerId));

    const pending = await capabilities.listByComplianceStatus({
      statuses: ['PENDING'],
      capabilityType: 'TEACHER',
      limit: 10,
    });
    expect(forMine(pending)).toHaveLength(1);
    expect(forMine(pending)[0]?.providerId).toBe(first);

    // Without the type filter, other capabilities of the same state appear.
    const notRequired = await capabilities.listByComplianceStatus({
      statuses: ['NOT_REQUIRED'],
      limit: 10,
    });
    expect(forMine(notRequired)).toHaveLength(1);
    expect(forMine(notRequired)[0]?.capabilityType).toBe('GRADUATE_TUTOR');

    // The type filter keeps non-teacher capabilities out of the queue.
    const teachersPending = await capabilities.listByComplianceStatus({
      statuses: ['PENDING'],
      capabilityType: 'TEACHER',
      limit: 10,
    });
    expect(teachersPending.every((row) => row.capabilityType === 'TEACHER')).toBe(true);

    expect(
      forMine(await capabilities.listByComplianceStatus({ statuses: ['APPROVED'], limit: 10 })),
    ).toHaveLength(0);

    const bounded = await capabilities.listByComplianceStatus({
      statuses: ['PENDING', 'UNDER_REVIEW'],
      capabilityType: 'TEACHER',
      limit: 1,
    });
    expect(bounded).toHaveLength(1);
  });

  it('reads provider names in one batch', async () => {
    const first = await newProvider(fixtureKey('name-a'));
    const second = await newProvider(fixtureKey('name-b'));

    const rows = await profiles.findManyByIds([
      first,
      second,
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual([first, second].sort());
    expect(await profiles.findManyByIds([])).toHaveLength(0);
  });
});
