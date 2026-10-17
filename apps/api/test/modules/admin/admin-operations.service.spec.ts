import { beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../../src/modules/audit/domain/audit-log.model';
import type { AuditLogRepository } from '../../../src/modules/audit/domain/audit-log.repository';
import type { ConfigService } from '@nestjs/config';

import { AdminOperationsService } from '../../../src/modules/admin/application/admin-operations.service';
import { FakeAdminReadModel, FakeAdminUserRepository, emptyDashboard } from './fakes';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const ACTOR = { actorUserId: ADMIN, requestId: 'req-1', ipHash: null };

function build() {
  const readModel = new FakeAdminReadModel();
  const users = new FakeAdminUserRepository();
  users.known.add(TARGET);
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

  const config = { get: () => 'test' } as unknown as ConfigService;
  return {
    service: new AdminOperationsService(readModel, users, audit, config),
    readModel,
    users,
    audits,
  };
}

type Context = ReturnType<typeof build>;

describe('AdminOperationsService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('returns the dashboard as the read model computed it', async () => {
    ctx.readModel.dashboardCounts = {
      ...emptyDashboard(),
      users: { total: 10, active: 8 },
      providers: { total: 3, approved: 2, pendingReview: 1, suspended: 0 },
      orders: { ...emptyDashboard().orders, total: 5, gmvMinor: 100_000, completed: 2 },
      conversion: { paidToCompletedBps: 4_000 },
    };

    const dashboard = await ctx.service.dashboard();
    expect(dashboard).toMatchObject({
      users: { total: 10, active: 8 },
      providers: { approved: 2, pendingReview: 1 },
      orders: { gmvMinor: 100_000 },
      conversion: { paidToCompletedBps: 4_000 },
    });
  });

  it('pages and filters users, providers, orders and audit logs', async () => {
    ctx.readModel.addUser({ id: 'u1', displayName: '李老师', status: 'ACTIVE' });
    ctx.readModel.addUser({ id: 'u2', displayName: '王家长', status: 'SUSPENDED' });
    ctx.readModel.addProvider({ id: 'p1', approvalStatus: 'APPROVED' });
    ctx.readModel.addProvider({ id: 'p2', approvalStatus: 'SUBMITTED' });
    ctx.readModel.addOrder({ id: 'o1', status: 'PAID' });
    ctx.readModel.addOrder({ id: 'o2', status: 'COMPLETED' });
    ctx.readModel.addAuditLog({ id: 'a1', action: 'PROVIDER_APPROVED' });
    ctx.readModel.addAuditLog({ id: 'a2', action: 'REFUND_INITIATED' });

    const users = await ctx.service.listUsers({ page: 1, pageSize: 1 });
    expect(users).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(users.items).toHaveLength(1);

    // Search and status narrow the listing.
    expect((await ctx.service.listUsers({ search: '李' })).total).toBe(1);
    expect((await ctx.service.listUsers({ status: 'SUSPENDED' })).total).toBe(1);

    // The provider queue is the review workflow of `specs/12`.
    const pending = await ctx.service.listProviders({ approvalStatus: 'SUBMITTED' });
    expect(pending.items.map((provider) => provider.id)).toEqual(['p2']);

    const completed = await ctx.service.listOrders({ status: 'COMPLETED' });
    expect(completed.items.map((order) => order.id)).toEqual(['o2']);

    const refunds = await ctx.service.listAuditLogs({ action: 'REFUND_INITIATED' });
    expect(refunds.items.map((row) => row.id)).toEqual(['a2']);
  });

  it('rejects an unbounded listing', async () => {
    await expect(ctx.service.listUsers({ pageSize: 51 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(ctx.service.listOrders({ page: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('audits granting a role with before and after', async () => {
    const result = await ctx.service.grantRole(ACTOR, TARGET, 'ops');

    expect(result).toMatchObject({ userId: TARGET, roles: ['OPS'] });
    expect(ctx.audits).toHaveLength(1);
    expect(ctx.audits[0]).toMatchObject({
      action: AUDIT_ACTIONS.roleGranted,
      actorUserId: ADMIN,
    });
    expect(ctx.audits[0]?.before).toMatchObject({ roles: [] });
    expect(ctx.audits[0]?.after).toMatchObject({ roles: ['OPS'], granted: 'OPS' });
  });

  it('audits revoking a role too', async () => {
    await ctx.service.grantRole(ACTOR, TARGET, 'ADMIN');
    const result = await ctx.service.revokeRole(ACTOR, TARGET, 'ADMIN');

    expect(result.roles).toEqual([]);
    expect(ctx.audits.map((entry) => entry.action)).toEqual([
      AUDIT_ACTIONS.roleGranted,
      AUDIT_ACTIONS.roleRevoked,
    ]);
    expect(ctx.audits[1]?.after).toMatchObject({ roles: [], revoked: 'ADMIN' });
  });

  it('bootstraps the first administrator, and only the first', async () => {
    ctx.users.known.add(ADMIN);

    const result = await ctx.service.bootstrapAdmin(ACTOR);
    expect(result.roles).toContain('ADMIN');
    // The bootstrap is audited like any other role change.
    expect(ctx.audits[0]?.after).toMatchObject({ granted: 'ADMIN', bootstrap: true });

    // It closes itself: a second call is refused.
    ctx.readModel.adminCount = 1;
    await expect(ctx.service.bootstrapAdmin(ACTOR)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(ctx.audits).toHaveLength(1);
  });

  it('refuses an unknown role and an unknown account', async () => {
    await expect(ctx.service.grantRole(ACTOR, TARGET, 'SUPERUSER')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(
      ctx.service.grantRole(ACTOR, '33333333-3333-4333-8333-333333333333', 'ADMIN'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(ctx.audits).toHaveLength(0);
  });
});
