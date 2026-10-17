import { beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../../src/modules/audit/domain/audit-log.model';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/audit-log.repository';
import { PlatformAdminService } from '../../../src/modules/platform/application/platform-admin.service';
import { FakeFeatureFlagRepository } from '../provider/fakes';
import { FakePlatformRuleRepository } from './fakes';

const ADMIN = 'admin-1';
const ACTOR = { actorUserId: ADMIN, requestId: 'req-1', ipHash: null };

function build() {
  const flags = new FakeFeatureFlagRepository();
  const rules = new FakePlatformRuleRepository();
  const audits: { action: string; actorUserId: string | null; before: unknown; after: unknown }[] =
    [];
  const audit = {
    record: async (input: {
      action: string;
      actorUserId: string | null;
      beforeJson?: unknown;
      afterJson?: unknown;
    }) => {
      audits.push({
        action: input.action,
        actorUserId: input.actorUserId,
        before: input.beforeJson,
        after: input.afterJson,
      });
    },
  } as unknown as AuditLogRepository;

  return { service: new PlatformAdminService(flags, rules, audit), flags, rules, audits };
}

type Context = ReturnType<typeof build>;

describe('PlatformAdminService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('lists the flags and audits every change', async () => {
    await ctx.flags.setEnabled('career_marketplace_enabled', false);

    const before = await ctx.service.listFlags();
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({ key: 'career_marketplace_enabled', enabled: false });

    // Turning a marketplace on is a production change: audited, with before/after.
    const after = await ctx.service.setFlag(ACTOR, 'career_marketplace_enabled', true);
    expect(after).toMatchObject({ enabled: true });

    expect(ctx.audits).toHaveLength(1);
    expect(ctx.audits[0]).toMatchObject({
      action: AUDIT_ACTIONS.featureFlagChanged,
      actorUserId: ADMIN,
    });
    expect(ctx.audits[0]?.before).toMatchObject({ enabled: false });
    expect(ctx.audits[0]?.after).toMatchObject({ enabled: true });
  });

  it('creates a rule as a draft and audits it', async () => {
    const rule = await ctx.service.createRule(ACTOR, {
      ruleType: 'refund_policy',
      version: '2026-10-01',
      contentRef: 'https://example.org/rules/refund/2026-10-01',
    });

    expect(rule).toMatchObject({ status: 'DRAFT', version: '2026-10-01' });
    expect(ctx.audits[0]?.action).toBe(AUDIT_ACTIONS.platformRuleCreated);
  });

  it('publishes a version and archives the one it replaces', async () => {
    const first = await ctx.service.createRule(ACTOR, {
      ruleType: 'refund_policy',
      version: 'v1',
      contentRef: 'https://example.org/rules/refund/v1',
    });
    await ctx.service.publishRule(ACTOR, first.id);

    const second = await ctx.service.createRule(ACTOR, {
      ruleType: 'refund_policy',
      version: 'v2',
      contentRef: 'https://example.org/rules/refund/v2',
    });
    const published = await ctx.service.publishRule(ACTOR, second.id);

    expect(published).toMatchObject({ status: 'PUBLISHED', version: 'v2' });
    // The version users were shown is archived, never rewritten (`specs/10`).
    expect((await ctx.rules.findById(first.id))?.status).toBe('ARCHIVED');
    expect((await ctx.rules.findPublished('refund_policy'))?.id).toBe(second.id);
    expect(ctx.audits.at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.platformRulePublished,
      actorUserId: ADMIN,
    });
    expect(ctx.audits.at(-1)?.before).toMatchObject({ published: 'v1' });
    expect(ctx.audits.at(-1)?.after).toMatchObject({ published: 'v2' });
  });

  it('refuses to publish twice, and refuses a rule that does not exist', async () => {
    const rule = await ctx.service.createRule(ACTOR, {
      ruleType: 'fee_policy',
      version: 'v1',
      contentRef: 'https://example.org/rules/fee/v1',
    });
    await ctx.service.publishRule(ACTOR, rule.id);

    await expect(ctx.service.publishRule(ACTOR, rule.id)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(ctx.service.publishRule(ACTOR, 'missing-rule')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('validates the rule type, version and content reference', async () => {
    for (const command of [
      { ruleType: 'Refund Policy', version: 'v1', contentRef: 'x' },
      { ruleType: 'refund_policy', version: '', contentRef: 'x' },
      { ruleType: 'refund_policy', version: 'v1', contentRef: '  ' },
    ]) {
      await expect(
        ctx.service.createRule(ACTOR, command),
        JSON.stringify(command),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }
    expect(ctx.audits).toHaveLength(0);
  });
});
