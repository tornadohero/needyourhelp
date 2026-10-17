import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaTaxonomyRepository } from '../../src/modules/catalog/infrastructure/prisma-taxonomy.repository';
import { createTestPrisma, describeWithDatabase, fixtureKey } from './helpers/test-database';

/** Repository adapter tests for the taxonomy (catalog module). */
describeWithDatabase('PrismaTaxonomyRepository', () => {
  const prisma: PrismaClient = createTestPrisma();
  let repository: PrismaTaxonomyRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaTaxonomyRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'ITEST_' } } });
    await prisma.$disconnect();
  });

  it('creates a term and reads it back by code', async () => {
    const code = `ITEST_${fixtureKey('SUBJECT').replace(/-/g, '_').toUpperCase()}`;

    const created = await repository.create({ type: 'SUBJECT', code, name: 'Integration Test' });
    expect(created.active).toBe(true);

    const found = await repository.findByCode('SUBJECT', code);
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('Integration Test');
  });

  it('lists terms of a type and can exclude archived ones', async () => {
    const code = `ITEST_${fixtureKey('SKILL').replace(/-/g, '_').toUpperCase()}`;
    const created = await repository.create({ type: 'SKILL', code, name: 'Archived Skill' });
    await prisma.taxonomyTerm.update({ where: { id: created.id }, data: { active: false } });

    const all = await repository.listByType('SKILL');
    expect(all.some((term) => term.id === created.id)).toBe(true);

    const activeOnly = await repository.listByType('SKILL', { activeOnly: true });
    expect(activeOnly.some((term) => term.id === created.id)).toBe(false);
  });

  it('separates taxonomy types', async () => {
    const code = `ITEST_${fixtureKey('CITY').replace(/-/g, '_').toUpperCase()}`;
    await repository.create({ type: 'CITY', code, name: 'Integration City' });

    expect(await repository.findByCode('CITY', code)).not.toBeNull();
    expect(await repository.findByCode('SUBJECT', code)).toBeNull();
  });
});
