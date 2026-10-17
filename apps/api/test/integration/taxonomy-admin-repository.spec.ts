import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaTaxonomyRepository } from '../../src/modules/catalog/infrastructure/prisma-taxonomy.repository';
import { createTestPrismaService, describeWithDatabase, fixtureKey } from './helpers/test-database';

/**
 * Persistence of the T008 taxonomy management against a real PostgreSQL
 * database (`specs/04-database-spec.md` §taxonomy_terms,
 * `specs/05-api-spec.md` §Taxonomy).
 *
 * The table is created by `prisma/migrations/20260929035555_init`; T008 adds no
 * migration — it only adds the management slice on top of it.
 */
describeWithDatabase('taxonomy administration repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaTaxonomyRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaTaxonomyRepository(prisma);
  });

  afterAll(async () => {
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T008_' } } });
    await prisma.$disconnect();
  });

  /** Codes are uppercase machine keys; `fixtureKey` supplies uniqueness. */
  function code(prefix: string): string {
    return `T008_${prefix}_${fixtureKey('x').replace(/-/g, '_').toUpperCase()}`;
  }

  it('creates a term and reads it back by id', async () => {
    const created = await repository.create({
      type: 'SUBJECT',
      code: code('CREATE'),
      name: '数学',
    });

    const found = await repository.findById(created.id);
    expect(found?.code).toBe(created.code);
    expect(found?.active).toBe(true);
    expect(found?.parentId).toBeNull();
    expect(await repository.findById('22222222-2222-4222-8222-222222222222')).toBeNull();
  });

  it('updates the mutable fields only', async () => {
    const parent = await repository.create({ type: 'SUBJECT', code: code('PARENT'), name: '数学' });
    const child = await repository.create({ type: 'SUBJECT', code: code('CHILD'), name: '代数' });

    const renamed = await repository.update(child.id, { name: '代数（新版）' });
    expect(renamed.name).toBe('代数（新版）');
    expect(renamed.parentId).toBeNull();

    const attached = await repository.update(child.id, { parentId: parent.id });
    expect(attached.parentId).toBe(parent.id);

    const detached = await repository.update(child.id, { parentId: null });
    expect(detached.parentId).toBeNull();

    const archived = await repository.update(child.id, { active: false });
    expect(archived.active).toBe(false);
  });

  it('keeps archived terms resolvable instead of deleting them', async () => {
    const created = await repository.create({ type: 'CITY', code: code('CITY'), name: '北京' });
    await repository.update(created.id, { active: false });

    // `service_terms` references the row and orders depend on the snapshot, so
    // an archived term must still resolve (`specs/05-api-spec.md` §Taxonomy).
    expect((await repository.findById(created.id))?.active).toBe(false);
    expect(await repository.findByCode('CITY', created.code)).not.toBeNull();
  });

  it('filters a bounded page', async () => {
    const parent = await repository.create({ type: 'SKILL', code: code('P1'), name: '作业辅导' });
    const childA = await repository.create({
      type: 'SKILL',
      code: code('C1'),
      name: '作业辅导-初级',
      parentId: parent.id,
    });
    await repository.update(childA.id, { active: false });
    const childB = await repository.create({
      type: 'SKILL',
      code: code('C2'),
      name: '作业辅导-高级',
      parentId: parent.id,
    });
    await repository.create({ type: 'GRADE', code: code('G1'), name: '小学一年级' });

    const children = await repository.list({
      type: 'SKILL',
      parentId: parent.id,
      page: 1,
      pageSize: 10,
    });
    expect(children.total).toBe(2);
    expect(children.items.map((term) => term.id).sort()).toEqual([childA.id, childB.id].sort());

    const activeChildren = await repository.list({
      type: 'SKILL',
      parentId: parent.id,
      active: true,
      page: 1,
      pageSize: 10,
    });
    expect(activeChildren.total).toBe(1);
    expect(activeChildren.items[0]?.id).toBe(childB.id);

    // A page is bounded and the total still reports the whole set.
    const firstPage = await repository.list({ type: 'SKILL', page: 1, pageSize: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(3);

    const secondPage = await repository.list({ type: 'SKILL', page: 2, pageSize: 2 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.total).toBe(3);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    // The grade term belongs to another type and never appears.
    const skills = await repository.list({ type: 'SKILL', page: 1, pageSize: 50 });
    expect(skills.items.every((term) => term.type === 'SKILL')).toBe(true);
  });

  it('orders a page deterministically by code', async () => {
    await repository.create({ type: 'SUBJECT', code: code('Z'), name: 'Z' });
    const page = await repository.list({ type: 'SUBJECT', page: 1, pageSize: 100 });
    const codes = page.items.map((term) => term.code);
    expect([...codes].sort()).toEqual(codes);
  });
});
