import { beforeEach, describe, expect, it } from 'vitest';

import { TaxonomyAdminService } from '../../../src/modules/catalog/application/taxonomy-admin.service';
import type { TaxonomyTerm } from '../../../src/modules/catalog/domain/taxonomy.model';
import { FakeAuditLogRepository } from '../provider/fakes';
import { FakeTaxonomyRepository } from './fakes';

const ADMIN = 'admin-1';
const REQUEST_ID = 'req-t008';

function build() {
  const terms = new FakeTaxonomyRepository();
  const audit = new FakeAuditLogRepository();
  const service = new TaxonomyAdminService(terms, audit);
  return { service, terms, audit };
}

type Context = ReturnType<typeof build>;

const context = { actorUserId: ADMIN, requestId: REQUEST_ID, ipHash: 'ip-hash' };

describe('TaxonomyAdminService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('creates a term with a normalized code and audits it', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: ' math ', name: ' 数学 ' },
      context,
    );

    expect(created.code).toBe('MATH');
    expect(created.name).toBe('数学');
    expect(created.active).toBe(true);
    expect(created.parentId).toBeNull();

    const row = ctx.audit.find('TAXONOMY_CREATED');
    expect(row?.actorUserId).toBe(ADMIN);
    expect(row?.actorType).toBe('ADMIN');
    expect(row?.resourceType).toBe('taxonomy_term');
    expect(row?.resourceId).toBe(created.id);
    expect(row?.beforeJson).toBeNull();
    expect(row?.afterJson).toMatchObject({ type: 'SUBJECT', code: 'MATH', active: true });
    expect(row?.ipHash).toBe('ip-hash');
    expect(row?.requestId).toBe(REQUEST_ID);
  });

  it('rejects an unusable code or name', async () => {
    await expect(
      ctx.service.create({ type: 'SUBJECT', code: '数学', name: '数学' }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    await expect(
      ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '   ' }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(ctx.audit.rows).toHaveLength(0);
  });

  it('keeps (type, code) unique but allows the same code in another type', async () => {
    await ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '数学' }, context);

    await expect(
      ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '数学课' }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create({ type: 'SKILL', code: 'MATH', name: '数学思维' }, context),
    ).resolves.toBeDefined();
    expect(ctx.audit.rows).toHaveLength(2);
  });

  it('validates the parent on create', async () => {
    const city = await ctx.service.create({ type: 'CITY', code: 'BEIJING', name: '北京' }, context);

    await expect(
      ctx.service.create(
        { type: 'SUBJECT', code: 'MATH', name: '数学', parentId: city.id },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create(
        { type: 'SUBJECT', code: 'MATH', name: '数学', parentId: 'not-a-uuid' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.service.create(
        {
          type: 'SUBJECT',
          code: 'MATH',
          name: '数学',
          parentId: '22222222-2222-4222-8222-222222222222',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('attaches a term to a parent of the same type', async () => {
    const subject = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );
    const algebra = await ctx.service.create(
      { type: 'SUBJECT', code: 'ALGEBRA', name: '代数', parentId: subject.id },
      context,
    );

    expect(algebra.parentId).toBe(subject.id);
  });

  it('refuses to attach a term to an archived parent', async () => {
    const subject = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );
    await ctx.service.archive(subject.id, context);

    await expect(
      ctx.service.create(
        { type: 'SUBJECT', code: 'ALGEBRA', name: '代数', parentId: subject.id },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updates the name and audits before/after', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );

    const updated = await ctx.service.update(created.id, { name: '数学（新版）' }, context);

    expect(updated.name).toBe('数学（新版）');
    const row = ctx.audit.find('TAXONOMY_UPDATED');
    expect(row?.beforeJson).toMatchObject({ name: '数学' });
    expect(row?.afterJson).toMatchObject({ name: '数学（新版）' });
  });

  it('treats an empty patch as a no-op', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );

    const updated = await ctx.service.update(created.id, {}, context);

    expect(updated).toEqual(created);
    expect(ctx.audit.find('TAXONOMY_UPDATED')).toBeUndefined();
  });

  it('moves a term and detaches it again', async () => {
    const math = await ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '数学' }, context);
    const physics = await ctx.service.create(
      { type: 'SUBJECT', code: 'PHYSICS', name: '物理' },
      context,
    );
    const algebra = await ctx.service.create(
      { type: 'SUBJECT', code: 'ALGEBRA', name: '代数', parentId: math.id },
      context,
    );

    const moved = await ctx.service.update(algebra.id, { parentId: physics.id }, context);
    expect(moved.parentId).toBe(physics.id);

    const detached = await ctx.service.update(algebra.id, { parentId: null }, context);
    expect(detached.parentId).toBeNull();
  });

  it('refuses a move that would create a cycle', async () => {
    const math = await ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '数学' }, context);
    const algebra = await ctx.service.create(
      { type: 'SUBJECT', code: 'ALGEBRA', name: '代数', parentId: math.id },
      context,
    );
    const equations = await ctx.service.create(
      { type: 'SUBJECT', code: 'EQUATIONS', name: '方程', parentId: algebra.id },
      context,
    );

    await expect(
      ctx.service.update(math.id, { parentId: equations.id }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      ctx.service.update(algebra.id, { parentId: equations.id }, context),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('archives a term instead of deleting it', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );

    const archived = await ctx.service.archive(created.id, context);
    expect(archived.active).toBe(false);

    // `service_terms` still references the term: it is never removed.
    expect(await ctx.terms.findById(created.id)).not.toBeNull();

    const row = ctx.audit.find('TAXONOMY_ARCHIVED');
    expect(row?.beforeJson).toMatchObject({ active: true });
    expect(row?.afterJson).toMatchObject({ active: false });
  });

  it('archives idempotently without a second audit row', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );

    await ctx.service.archive(created.id, context);
    await ctx.service.archive(created.id, context);

    expect(ctx.audit.rows.filter((row) => row.action === 'TAXONOMY_ARCHIVED')).toHaveLength(1);
  });

  it('restores an archived term through a patch', async () => {
    const created = await ctx.service.create(
      { type: 'SUBJECT', code: 'MATH', name: '数学' },
      context,
    );
    await ctx.service.archive(created.id, context);

    const restored = await ctx.service.update(created.id, { active: true }, context);
    expect(restored.active).toBe(true);
    expect(ctx.audit.find('TAXONOMY_UPDATED')?.afterJson).toMatchObject({ active: true });
  });

  it('returns NOT_FOUND for an unknown or malformed id', async () => {
    for (const id of ['22222222-2222-4222-8222-222222222222', 'not-a-uuid']) {
      await expect(ctx.service.update(id, { name: 'x' }, context)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      await expect(ctx.service.archive(id, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(ctx.audit.rows).toHaveLength(0);
  });

  it('lists a bounded page with filters', async () => {
    const math = await ctx.service.create({ type: 'SUBJECT', code: 'MATH', name: '数学' }, context);
    const physics = await ctx.service.create(
      { type: 'SUBJECT', code: 'PHYSICS', name: '物理' },
      context,
    );
    await ctx.service.create({ type: 'CITY', code: 'BEIJING', name: '北京' }, context);
    await ctx.service.archive(physics.id, context);

    const page = await ctx.service.list({ type: 'SUBJECT', page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.items.map((term: TaxonomyTerm) => term.code)).toEqual(['MATH', 'PHYSICS']);

    const activeOnly = await ctx.service.list({
      type: 'SUBJECT',
      active: true,
      page: 1,
      pageSize: 10,
    });
    expect(activeOnly.total).toBe(1);
    expect(activeOnly.items[0]?.id).toBe(math.id);

    const children = await ctx.service.list({ parentId: math.id, page: 1, pageSize: 10 });
    expect(children.total).toBe(0);

    const paged = await ctx.service.list({ page: 2, pageSize: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
  });
});
