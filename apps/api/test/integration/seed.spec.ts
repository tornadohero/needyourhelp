import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  SEED_FEATURE_FLAGS,
  SEED_TAXONOMY,
  SEED_USERS,
  seedDatabase,
  seedOpenidHash,
} from '../../../../prisma/seed-data';
import { createTestPrisma, describeWithDatabase } from './helpers/test-database';

/**
 * T002 acceptance: "seed creates admin/test users and taxonomy".
 * Also asserts the seed is idempotent, because it is re-run on every reset.
 */
describeWithDatabase('database seed', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates admin and test users with their roles', async () => {
    await seedDatabase(prisma);

    for (const spec of SEED_USERS) {
      const user = await prisma.user.findUnique({
        where: { wechatOpenidHash: seedOpenidHash(spec.seedKey) },
        include: { roles: true },
      });

      expect(user, `seeded user ${spec.seedKey}`).not.toBeNull();
      expect(user?.displayName).toBe(spec.displayName);
      expect(user?.status).toBe('ACTIVE');
      expect(user?.roles.map((role) => role.role).sort()).toEqual([...spec.roles].sort());
    }
  });

  it('creates the taxonomy', async () => {
    await seedDatabase(prisma);

    for (const [type, terms] of Object.entries(SEED_TAXONOMY)) {
      const rows = await prisma.taxonomyTerm.findMany({
        where: { type: type as keyof typeof SEED_TAXONOMY },
      });

      for (const term of terms) {
        const row = rows.find((candidate) => candidate.code === term.code);
        expect(row, `${type}/${term.code}`).toBeDefined();
        expect(row?.active).toBe(true);
      }
    }
  });

  it('seeds feature flags with career disabled', async () => {
    await seedDatabase(prisma);

    for (const flag of SEED_FEATURE_FLAGS) {
      const row = await prisma.featureFlag.findUnique({ where: { key: flag.key } });
      expect(row, flag.key).not.toBeNull();
    }

    const career = await prisma.featureFlag.findUnique({
      where: { key: 'career_marketplace_enabled' },
    });
    expect(career?.enabled).toBe(false);
  });

  it('is idempotent', async () => {
    const first = await seedDatabase(prisma);
    const userCountAfterFirstRun = await prisma.user.count();
    const termCountAfterFirstRun = await prisma.taxonomyTerm.count();

    const second = await seedDatabase(prisma);

    expect(second.users).toHaveLength(first.users.length);
    expect(second.userRoles).toHaveLength(first.userRoles.length);
    expect(second.taxonomyTerms).toHaveLength(first.taxonomyTerms.length);
    expect(await prisma.user.count()).toBe(userCountAfterFirstRun);
    expect(await prisma.taxonomyTerm.count()).toBe(termCountAfterFirstRun);
  });
});
