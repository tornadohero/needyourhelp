import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { PrismaConsentRepository } from '../../src/modules/identity/infrastructure/prisma-consent.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaChildProfileRepository } from '../../src/modules/profile/infrastructure/prisma-child-profile.repository';
import { PrismaParentProfileRepository } from '../../src/modules/profile/infrastructure/prisma-parent-profile.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Repository behaviour for the T004 tables against a real PostgreSQL database
 * (`specs/04-database-spec.md` §parent_profiles / §child_profiles / §consents).
 *
 * No schema change is made here: T004 reuses the T002 design as-is.
 */
describeWithDatabase('profile repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let parents: PrismaParentProfileRepository;
  let children: PrismaChildProfileRepository;
  let consents: PrismaConsentRepository;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    parents = new PrismaParentProfileRepository(prisma);
    children = new PrismaChildProfileRepository(prisma);
    consents = new PrismaConsentRepository(prisma);
  });

  afterAll(async () => {
    await prisma.childProfile.deleteMany({ where: { guardianUserId: { in: userIds } } });
    await prisma.consent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parentProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newUser(): Promise<string> {
    const user = await new PrismaUserRepository(prisma).create({
      displayName: `t004-${randomUUID()}`,
    });
    userIds.push(user.id);
    return user.id;
  }

  it('keeps one parent profile per account on repeated upserts', async () => {
    const userId = await newUser();

    const first = await parents.upsert({
      userId,
      displayName: 'Guardian One',
      cityCode: 'BEIJING',
      timezone: 'Asia/Shanghai',
    });
    const second = await parents.upsert({
      userId,
      displayName: 'Guardian One',
      cityCode: 'SHANGHAI',
    });

    expect(second.id).toBe(first.id);
    expect(second.cityCode).toBe('SHANGHAI');
    expect(second.timezone).toBe('Asia/Shanghai');
    expect(await prisma.parentProfile.count({ where: { userId } })).toBe(1);
  });

  it('lists only live children of the requested guardian', async () => {
    const guardian = await newUser();
    const other = await newUser();

    const mine = await children.create({
      guardianUserId: guardian,
      nickname: 'mine',
      dataProcessingConsentStatus: 'GRANTED',
    });
    await children.create({
      guardianUserId: other,
      nickname: 'theirs',
      dataProcessingConsentStatus: 'GRANTED',
    });

    expect(await children.listByGuardian(guardian)).toHaveLength(1);

    await children.softDelete(mine.id);
    expect(await children.listByGuardian(guardian)).toHaveLength(0);
    // Soft delete keeps the row: order history must still resolve.
    expect(await prisma.childProfile.count({ where: { id: mine.id } })).toBe(1);
    expect((await children.findById(mine.id))?.deletedAt).not.toBeNull();
  });

  it('mirrors guardian consent only onto that guardian’s live children', async () => {
    const guardian = await newUser();
    const other = await newUser();

    const live = await children.create({
      guardianUserId: guardian,
      nickname: 'live',
      dataProcessingConsentStatus: 'PENDING',
    });
    const deleted = await children.create({
      guardianUserId: guardian,
      nickname: 'deleted',
      dataProcessingConsentStatus: 'PENDING',
    });
    await children.softDelete(deleted.id);
    const foreign = await children.create({
      guardianUserId: other,
      nickname: 'foreign',
      dataProcessingConsentStatus: 'PENDING',
    });

    const updated = await children.setConsentStatusForGuardian(guardian, 'REVOKED');

    expect(updated).toBe(1);
    expect((await children.findById(live.id))?.dataProcessingConsentStatus).toBe('REVOKED');
    expect((await children.findById(deleted.id))?.dataProcessingConsentStatus).toBe('PENDING');
    expect((await children.findById(foreign.id))?.dataProcessingConsentStatus).toBe('PENDING');
  });

  it('appends consent grants and withdraws only the active one', async () => {
    const userId = await newUser();

    const first = await consents.grant({
      userId,
      consentType: 'TERMS',
      policyVersion: 'v1',
      evidenceRef: 'request:1',
    });
    await consents.revokeActive(userId, 'TERMS');
    const second = await consents.grant({
      userId,
      consentType: 'TERMS',
      policyVersion: 'v2',
    });

    expect(first.id).not.toBe(second.id);
    expect(await consents.findActive(userId, 'TERMS')).toMatchObject({ policyVersion: 'v2' });

    const revoked = await consents.revokeActive(userId, 'TERMS');
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await consents.findActive(userId, 'TERMS')).toBeNull();
    // History is preserved for audit.
    expect(await prisma.consent.count({ where: { userId } })).toBe(2);

    expect(await consents.revokeActive(userId, 'TERMS')).toBeNull();
  });

  it('lists a user’s consent history newest first', async () => {
    const userId = await newUser();
    await consents.grant({ userId, consentType: 'PRIVACY', policyVersion: 'v1' });
    await consents.grant({ userId, consentType: 'MARKETING', policyVersion: 'v1' });

    const history = await consents.listByUser(userId);
    expect(history).toHaveLength(2);
    expect(history.map((consent) => consent.consentType)).toContain('PRIVACY');
    expect(history[0]?.grantedAt.getTime()).toBeGreaterThanOrEqual(
      history[1]?.grantedAt.getTime() ?? 0,
    );
  });

  it('updates only the account display fields', async () => {
    const userId = await newUser();
    const users = new PrismaUserRepository(prisma);

    const updated = await users.updateProfile(userId, {
      displayName: 'Renamed',
      avatarUrl: 'https://cdn.example/a.png',
    });

    expect(updated.displayName).toBe('Renamed');
    expect(updated.avatarUrl).toBe('https://cdn.example/a.png');
    expect(updated.status).toBe('ACTIVE');
  });
});
