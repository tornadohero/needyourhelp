import { afterAll, beforeAll, expect, it } from 'vitest';

import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase, fixtureKey } from './helpers/test-database';

/**
 * Repository behaviour for the T005 tables against a real PostgreSQL database
 * (`specs/04-database-spec.md` §provider_profiles / §provider_capabilities /
 * §audit_logs). No schema change: T005 reuses the T002 design as-is.
 */
describeWithDatabase('provider repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let profiles: PrismaProviderProfileRepository;
  let capabilities: PrismaProviderCapabilityRepository;
  let audit: PrismaAuditLogRepository;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    profiles = new PrismaProviderProfileRepository(prisma);
    capabilities = new PrismaProviderCapabilityRepository(prisma);
    audit = new PrismaAuditLogRepository(prisma);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { resourceType: 'provider_profile' } });
    await prisma.providerCapability.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newUser(): Promise<string> {
    const user = await new PrismaUserRepository(prisma).create({
      displayName: fixtureKey('t005'),
    });
    userIds.push(user.id);
    return user.id;
  }

  it('creates a draft, never-searchable application per account and type', async () => {
    const userId = await newUser();

    const tutoring = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });

    expect(tutoring.approvalStatus).toBe('DRAFT');
    expect(tutoring.searchable).toBe(false);
    expect(tutoring.avatarVisibility).toBe('PRIVATE');
    expect(await profiles.findByUserAndType(userId, 'TUTORING')).not.toBeNull();
    expect(await profiles.findByUserAndType(userId, 'CAREER')).toBeNull();
    expect(await profiles.listByUser(userId)).toHaveLength(1);
  });

  it('updates only the self-service fields', async () => {
    const userId = await newUser();
    const created = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });

    const updated = await profiles.update(created.id, {
      publicName: '李老师（高级）',
      cityCode: 'BEIJING',
      serviceMode: 'HYBRID',
    });

    expect(updated.publicName).toBe('李老师（高级）');
    expect(updated.cityCode).toBe('BEIJING');
    expect(updated.serviceMode).toBe('HYBRID');
    // Never touched by an update: status and discovery stay server-owned.
    expect(updated.approvalStatus).toBe('DRAFT');
    expect(updated.searchable).toBe(false);
  });

  it('sets approval status and searchable independently', async () => {
    const userId = await newUser();
    const created = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });

    const submitted = await profiles.setApprovalStatus(created.id, 'SUBMITTED');
    const approved = await profiles.setApprovalStatus(created.id, 'APPROVED');
    const searchable = await profiles.setSearchable(created.id, true);

    expect(submitted.approvalStatus).toBe('SUBMITTED');
    expect(approved.approvalStatus).toBe('APPROVED');
    expect(searchable.searchable).toBe(true);
    expect(await prisma.providerProfile.count({ where: { id: created.id } })).toBe(1);
  });

  it('creates and replaces capabilities atomically', async () => {
    const userId = await newUser();
    const profile = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });

    await capabilities.createMany([
      { providerId: profile.id, capabilityType: 'STUDENT_TUTOR', complianceStatus: 'NOT_REQUIRED' },
      { providerId: profile.id, capabilityType: 'TEACHER', complianceStatus: 'PENDING' },
    ]);

    expect(await capabilities.listByProvider(profile.id)).toHaveLength(2);
    expect(
      (await capabilities.findByProviderAndType(profile.id, 'TEACHER'))?.complianceStatus,
    ).toBe('PENDING');

    const replaced = await capabilities.replaceForProvider(profile.id, [
      { providerId: profile.id, capabilityType: 'PHD_TUTOR' },
    ]);

    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.capabilityType).toBe('PHD_TUTOR');
    expect(replaced[0]?.status).toBe('DRAFT');
    expect(replaced[0]?.verificationLevel).toBe('NONE');
    expect(await capabilities.findByProviderAndType(profile.id, 'TEACHER')).toBeNull();
  });

  it('updates a capability status without touching its type', async () => {
    const userId = await newUser();
    const profile = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });
    const [capability] = await capabilities.createMany([
      { providerId: profile.id, capabilityType: 'STUDENT_TUTOR' },
    ]);

    const updated = await capabilities.update(capability?.id ?? '', {
      status: 'APPROVED',
      verificationLevel: 'FULL',
    });

    expect(updated.status).toBe('APPROVED');
    expect(updated.verificationLevel).toBe('FULL');
    expect(updated.capabilityType).toBe('STUDENT_TUTOR');
  });

  it('appends audit rows with before/after snapshots', async () => {
    const userId = await newUser();
    const profile = await profiles.create({
      userId,
      providerType: 'TUTORING',
      publicName: '李老师',
    });

    await audit.record({
      actorUserId: userId,
      actorType: 'ADMIN',
      action: 'PROVIDER_APPROVED',
      resourceType: 'provider_profile',
      resourceId: profile.id,
      beforeJson: { approvalStatus: 'SUBMITTED' },
      afterJson: { approvalStatus: 'APPROVED' },
      requestId: 'req-1',
    });

    const rows = await audit.listByResource('provider_profile', profile.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.beforeJson).toMatchObject({ approvalStatus: 'SUBMITTED' });
    expect(rows[0]?.afterJson).toMatchObject({ approvalStatus: 'APPROVED' });
    expect(rows[0]?.requestId).toBe('req-1');
  });
});
