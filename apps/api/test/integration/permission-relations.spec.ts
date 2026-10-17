import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createTestPrisma,
  describeWithDatabase,
  isUniqueConstraintError,
} from './helpers/test-database';

/**
 * Identity/profile relationships the permission model depends on
 * (`specs/07-permission-spec.md`, `specs/10-privacy-and-minors.md`):
 *
 * - a user may hold several roles, but each role only once
 * - one parent profile per user
 * - child profiles belong to a guardian and are invisible to other accounts
 * - provider ownership: one status per capability
 * - an approved verification case does not approve the provider
 */
describeWithDatabase('permission data relationships: identity and profiles', () => {
  const prisma: PrismaClient = createTestPrisma();
  const suffix = randomUUID();
  const ids = {
    guardian: '',
    other: '',
    providerUser: '',
    providerProfile: '',
    capabilityTutor: '',
    capabilityTeacher: '',
    verificationCase: '',
    child: '',
    parentProfile: '',
  };

  beforeAll(async () => {
    await prisma.$connect();

    const guardian = await prisma.user.create({
      data: { displayName: `perm-itest-guardian-${suffix}` },
    });
    const other = await prisma.user.create({ data: { displayName: `perm-itest-other-${suffix}` } });
    const providerUser = await prisma.user.create({
      data: { displayName: `perm-itest-provider-${suffix}` },
    });

    const providerProfile = await prisma.providerProfile.create({
      data: { userId: providerUser.id, publicName: `perm-itest-${suffix}` },
    });
    const capabilityTutor = await prisma.providerCapability.create({
      data: {
        providerId: providerProfile.id,
        capabilityType: 'STUDENT_TUTOR',
        status: 'APPROVED',
        verificationLevel: 'FULL',
        complianceStatus: 'NOT_REQUIRED',
      },
    });
    const capabilityTeacher = await prisma.providerCapability.create({
      data: {
        providerId: providerProfile.id,
        capabilityType: 'TEACHER',
        status: 'UNDER_REVIEW',
        verificationLevel: 'IDENTITY',
        complianceStatus: 'PENDING',
      },
    });
    const verificationCase = await prisma.verificationCase.create({
      data: {
        providerId: providerProfile.id,
        verificationType: 'IDENTITY',
        status: 'APPROVED',
        reviewerId: other.id,
      },
    });
    const child = await prisma.childProfile.create({
      data: {
        guardianUserId: guardian.id,
        nickname: 'perm-itest-child',
        gradeCode: 'PRIMARY_3',
        dataProcessingConsentStatus: 'GRANTED',
      },
    });
    const parentProfile = await prisma.parentProfile.create({
      data: { userId: guardian.id, displayName: 'perm-itest-parent' },
    });

    ids.guardian = guardian.id;
    ids.other = other.id;
    ids.providerUser = providerUser.id;
    ids.providerProfile = providerProfile.id;
    ids.capabilityTutor = capabilityTutor.id;
    ids.capabilityTeacher = capabilityTeacher.id;
    ids.verificationCase = verificationCase.id;
    ids.child = child.id;
    ids.parentProfile = parentProfile.id;
  });

  afterAll(async () => {
    await prisma.childProfile.deleteMany({ where: { guardianUserId: { in: [ids.guardian] } } });
    await prisma.parentProfile.deleteMany({ where: { userId: { in: [ids.guardian] } } });
    await prisma.verificationCase.deleteMany({ where: { id: ids.verificationCase } });
    await prisma.providerCapability.deleteMany({
      where: { id: { in: [ids.capabilityTutor, ids.capabilityTeacher] } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: ids.providerProfile } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.guardian, ids.other, ids.providerUser] } },
    });
    await prisma.$disconnect();
  });

  it('allows multiple roles per user but rejects a duplicate role', async () => {
    await prisma.userRole.create({ data: { userId: ids.guardian, role: 'PARENT' } });
    await prisma.userRole.create({ data: { userId: ids.guardian, role: 'MODERATOR' } });

    let error: unknown;
    try {
      await prisma.userRole.create({ data: { userId: ids.guardian, role: 'PARENT' } });
    } catch (caught) {
      error = caught;
    }

    expect(isUniqueConstraintError(error)).toBe(true);

    const roles = await prisma.userRole.findMany({ where: { userId: ids.guardian } });
    expect(roles.map((row) => row.role).sort()).toEqual(['MODERATOR', 'PARENT']);
  });

  it('allows at most one parent profile per user', async () => {
    let error: unknown;
    try {
      await prisma.parentProfile.create({
        data: { userId: ids.guardian, displayName: 'duplicate' },
      });
    } catch (caught) {
      error = caught;
    }

    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it('isolates child profiles to their guardian', async () => {
    const guardianChildren = await prisma.childProfile.findMany({
      where: { guardianUserId: ids.guardian, deletedAt: null },
    });
    const otherChildren = await prisma.childProfile.findMany({
      where: { guardianUserId: ids.other, deletedAt: null },
    });

    expect(guardianChildren.map((child) => child.id)).toEqual([ids.child]);
    expect(otherChildren).toHaveLength(0);
  });

  it('soft-deletes a child profile instead of removing it', async () => {
    await prisma.childProfile.update({
      where: { id: ids.child },
      data: { deletedAt: new Date() },
    });
    expect(
      await prisma.childProfile.findMany({
        where: { guardianUserId: ids.guardian, deletedAt: null },
      }),
    ).toHaveLength(0);

    const persisted = await prisma.childProfile.findUnique({ where: { id: ids.child } });
    expect(persisted?.deletedAt).not.toBeNull();
    expect(persisted?.nickname).toBe('perm-itest-child');

    await prisma.childProfile.update({ where: { id: ids.child }, data: { deletedAt: null } });
  });

  it('keeps one status per provider capability', async () => {
    const capabilities = await prisma.providerCapability.findMany({
      where: { providerId: ids.providerProfile },
      orderBy: { capabilityType: 'asc' },
    });

    expect(capabilities).toHaveLength(2);
    const tutor = capabilities.find((row) => row.capabilityType === 'STUDENT_TUTOR');
    const teacher = capabilities.find((row) => row.capabilityType === 'TEACHER');

    expect(tutor?.status).toBe('APPROVED');
    expect(tutor?.complianceStatus).toBe('NOT_REQUIRED');
    expect(teacher?.status).toBe('UNDER_REVIEW');
    expect(teacher?.complianceStatus).toBe('PENDING');
  });

  it('does not approve a provider when a verification case is approved', async () => {
    const verification = await prisma.verificationCase.findUnique({
      where: { id: ids.verificationCase },
    });
    const provider = await prisma.providerProfile.findUnique({
      where: { id: ids.providerProfile },
    });

    expect(verification?.status).toBe('APPROVED');
    expect(provider?.approvalStatus).toBe('DRAFT');
    expect(provider?.searchable).toBe(false);
  });
});
