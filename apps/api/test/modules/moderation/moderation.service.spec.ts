import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditLogRepository } from '../../../src/modules/audit/domain/audit-log.repository';
import { AUDIT_ACTIONS } from '../../../src/modules/audit/domain/audit-log.model';
import type { Order } from '../../../src/modules/orders/domain/order.model';
import type { OrderService } from '../../../src/modules/orders/application/order.service';
import { orderInvalidState } from '../../../src/modules/orders/domain/order.errors';
import { ModerationService } from '../../../src/modules/moderation/application/moderation.service';
import { FakeModerationRepository } from './fakes';
import { FakeProviderProfileRepository } from '../provider/fakes';
import { FakeReviewRepository } from '../reviews/fakes';
import { FakeServiceRepository } from '../services/fakes';

const REPORTER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const OTHER_ADMIN = '55555555-5555-4555-8555-555555555555';
const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const ORDER_ID = '00000000-0000-4000-8000-0000000000cc';

function order(status: Order['status'] = 'PAID'): Order {
  return {
    id: ORDER_ID,
    orderNo: 'MO-20261001-ABCDEF01',
    buyerUserId: REPORTER,
    providerId: PROVIDER_ID,
    serviceId: '00000000-0000-4000-8000-0000000000dd',
    childId: null,
    domain: 'TUTORING',
    status,
    amountMinor: 20_000,
    platformFeeMinor: 2_000,
    providerAmountMinor: 18_000,
    currency: 'CNY',
    scheduledStart: new Date(Date.now() + 60 * 60_000),
    scheduledEnd: new Date(Date.now() + 120 * 60_000),
    priceSnapshot: {
      serviceId: '00000000-0000-4000-8000-0000000000dd',
      title: '数学一对一',
      priceMinor: 20_000,
      currency: 'CNY',
      durationMinutes: 60,
    },
    policySnapshot: {
      feeVersion: 'platform-fee-v1',
      feeRateBps: 1_000,
      cancellationPolicyId: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function build(options: { orderStatus?: Order['status'] } = {}) {
  const moderation = new FakeModerationRepository();
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

  const profiles = new FakeProviderProfileRepository();
  void profiles.profiles.set(PROVIDER_ID, {
    id: PROVIDER_ID,
    userId: OWNER,
    providerType: 'TUTORING',
    publicName: '李老师',
    headline: null,
    bio: null,
    avatarVisibility: 'PRIVATE',
    avatarAssetId: null,
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    approvalStatus: 'APPROVED',
    searchable: true,
    ratingAvg: 5,
    ratingCount: 1,
    completedOrderCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const reviews = new FakeReviewRepository();
  const services = new FakeServiceRepository({ findById: async () => null });
  const currentOrder = order(options.orderStatus ?? 'PAID');
  const disputed: string[] = [];

  const orders = {
    findById: async (id: string) => (id === currentOrder.id ? currentOrder : null),
    markDispute: async (id: string) => {
      disputed.push(id);
      currentOrder.status = 'DISPUTED';
      return currentOrder;
    },
  } as unknown as OrderService;

  const service = new ModerationService(moderation, audit, profiles, services, reviews, orders);

  return { service, moderation, audits, reviews, disputed, currentOrder };
}

type Context = ReturnType<typeof build>;

const ACTOR = { actorUserId: ADMIN, requestId: 'req-1', ipHash: null };

describe('ModerationService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('takes a report and opens exactly one active case per target', async () => {
    const first = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'HARASSMENT',
      description: '骚扰内容',
    });
    expect(first.caseCreated).toBe(true);

    // A second report on the same target joins the case that is already open.
    const second = await ctx.service.createReport(STRANGER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'OTHER',
    });
    expect(second.caseCreated).toBe(false);
    expect(second.caseId).toBe(first.caseId);
    expect(ctx.moderation.reports).toHaveLength(2);
    expect(ctx.moderation.cases).toHaveLength(1);
  });

  it('refuses a target that is not a uuid', async () => {
    await expect(
      ctx.service.createReport(REPORTER, {
        targetType: 'USER',
        targetId: 'not-a-uuid',
        reasonCode: 'OTHER',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(ctx.moderation.reports).toHaveLength(0);
  });

  it('lists what the caller reported, and the queue for admins', async () => {
    await ctx.service.createReport(REPORTER, {
      targetType: 'ORDER',
      targetId: ORDER_ID,
      reasonCode: 'PAYMENT_ISSUE',
    });
    await ctx.service.createReport(STRANGER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'FRAUD',
    });

    const mine = await ctx.service.listOwnReports(REPORTER);
    expect(mine.total).toBe(1);
    expect(mine.page).toBe(1);

    const queue = await ctx.service.listQueue();
    expect(queue.total).toBe(2);
    expect(await ctx.service.listQueue({ status: 'OPEN' })).toMatchObject({ total: 2 });
    expect(await ctx.service.listQueue({ status: 'FINALIZED' })).toMatchObject({ total: 0 });
  });

  it('audits every resolution with actor, reason and before/after', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'HARASSMENT',
    });

    const resolved = await ctx.service.resolveReport(ACTOR, created.reportId, {
      resolution: '已警告用户',
    });

    expect(resolved).toMatchObject({
      reportStatus: 'RESOLVED',
      caseStatus: 'RESOLVED',
      actionTaken: 'NO_ACTION',
    });

    expect(ctx.audits).toHaveLength(1);
    expect(ctx.audits[0]).toMatchObject({
      action: AUDIT_ACTIONS.moderationResolved,
      actorUserId: ADMIN,
    });
    expect(ctx.audits[0]?.before).toMatchObject({ reportStatus: 'PENDING', caseStatus: 'OPEN' });
    expect(ctx.audits[0]?.after).toMatchObject({
      reportStatus: 'RESOLVED',
      resolution: '已警告用户',
    });
  });

  it('can dismiss a report, and refuses to decide twice', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'OTHER',
    });

    const dismissed = await ctx.service.resolveReport(ACTOR, created.reportId, {
      resolution: '证据不足',
      outcome: 'DISMISSED',
    });
    expect(dismissed.reportStatus).toBe('DISMISSED');

    await expect(
      ctx.service.resolveReport(ACTOR, created.reportId, { resolution: '再来一次' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ctx.audits).toHaveLength(1);
  });

  it('refuses a decision without a reason, and an action on the wrong target', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'OTHER',
    });

    await expect(
      ctx.service.resolveReport(ACTOR, created.reportId, { resolution: '  ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    await expect(
      ctx.service.resolveReport(ACTOR, created.reportId, {
        resolution: '隐藏内容',
        action: 'HIDE_REVIEW',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ctx.audits).toHaveLength(0);
  });

  it('hides the review it decided to hide', async () => {
    const review = await ctx.reviews.create({
      orderId: ORDER_ID,
      reviewerUserId: REPORTER,
      revieweeUserId: OWNER,
      rating: 5,
      content: '很好',
    });
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'REVIEW',
      targetId: review.id,
      reasonCode: 'INAPPROPRIATE_CONTENT',
    });

    const resolved = await ctx.service.resolveReport(ACTOR, created.reportId, {
      resolution: '内容违规',
      action: 'HIDE_REVIEW',
    });

    expect(resolved.actionTaken).toBe('HIDE_REVIEW');
    expect((await ctx.reviews.findById(review.id))?.status).toBe('HIDDEN');
  });

  it('disputes the order it decided to dispute', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'ORDER',
      targetId: ORDER_ID,
      reasonCode: 'PAYMENT_ISSUE',
    });

    const resolved = await ctx.service.resolveReport(ACTOR, created.reportId, {
      resolution: '转争议处理',
      action: 'DISPUTE_ORDER',
    });

    expect(resolved.actionTaken).toBe('DISPUTE_ORDER');
    expect(ctx.disputed).toEqual([ORDER_ID]);
    expect(ctx.currentOrder.status).toBe('DISPUTED');
  });

  it('moves a case through the machine, but never to a decided state', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'FRAUD',
    });

    const investigating = await ctx.service.transitionCase(ACTOR, created.caseId, {
      status: 'INVESTIGATING',
      note: '联系双方',
    });
    expect(investigating.status).toBe('INVESTIGATING');
    expect(ctx.audits[0]?.action).toBe(AUDIT_ACTIONS.moderationCaseTransitioned);

    await expect(
      ctx.service.transitionCase(ACTOR, created.caseId, { status: 'RESOLVED' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // A finalised case cannot be reopened.
    await ctx.service.resolveReport(ACTOR, created.reportId, { resolution: '处理完成' });
    await expect(
      ctx.service.transitionCase(ACTOR, created.caseId, { status: 'INVESTIGATING' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('supports the appeal path: filed by a party, reviewed by somebody else', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'ORDER',
      targetId: ORDER_ID,
      reasonCode: 'UNSAFE_BEHAVIOR',
    });
    await ctx.service.resolveReport(ACTOR, created.reportId, { resolution: '暂停服务' });

    // A stranger cannot appeal somebody else's report.
    await expect(
      ctx.service.appeal(STRANGER, created.reportId, { reason: '不同意', requestId: 'req-2' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    // The reporter can, and the case reopens for review.
    const appealed = await ctx.service.appeal(REPORTER, created.reportId, {
      reason: '我没有违规',
      requestId: 'req-2',
    });
    expect(appealed).toMatchObject({ status: 'APPEALED', appealReason: '我没有违规' });
    expect(ctx.audits.map((entry) => entry.action)).toContain(AUDIT_ACTIONS.moderationAppealFiled);

    // The moderator who decided it may not review their own decision.
    await expect(
      ctx.service.finalizeAppeal(ACTOR, appealed.id, {
        decision: 'UPHELD',
        decisionReason: '维持原判',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Another moderator closes it, and that is audited too.
    const finalized = await ctx.service.finalizeAppeal(
      { actorUserId: OTHER_ADMIN, requestId: 'req-3', ipHash: null },
      appealed.id,
      { decision: 'UPHELD', decisionReason: '维持原判' },
    );
    expect(finalized).toMatchObject({
      status: 'FINALIZED',
      decision: 'UPHELD',
      appealReviewerId: OTHER_ADMIN,
    });
    expect(ctx.audits.at(-1)).toMatchObject({
      action: AUDIT_ACTIONS.moderationAppealFinalized,
      actorUserId: OTHER_ADMIN,
    });
    // Finalised is terminal.
    await expect(
      ctx.service.finalizeAppeal(
        { actorUserId: OTHER_ADMIN, requestId: 'req-4', ipHash: null },
        appealed.id,
        { decision: 'UPHELD', decisionReason: '再来一次' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lets the owner of the target appeal, and only while the case is resolved', async () => {
    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'ORDER',
      targetId: ORDER_ID,
      reasonCode: 'PAYMENT_ISSUE',
    });

    // Not decided yet: there is nothing to appeal.
    await expect(
      ctx.service.appeal(OWNER, created.reportId, { reason: '太早了', requestId: 'req-2' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await ctx.service.resolveReport(ACTOR, created.reportId, {
      resolution: '退款处理',
      outcome: 'DISMISSED',
    });
    const appealed = await ctx.service.appeal(OWNER, created.reportId, {
      reason: '订单已完成',
      requestId: 'req-2',
    });
    expect(appealed.status).toBe('APPEALED');
  });

  it('refuses an appeal without a reason and an unknown report', async () => {
    await expect(
      ctx.service.appeal(REPORTER, 'missing-report', { reason: 'x', requestId: 'req-2' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const created = await ctx.service.createReport(REPORTER, {
      targetType: 'USER',
      targetId: OWNER,
      reasonCode: 'OTHER',
    });
    await ctx.service.resolveReport(ACTOR, created.reportId, { resolution: '处理完成' });
    await expect(
      ctx.service.appeal(REPORTER, created.reportId, { reason: '  ', requestId: 'req-2' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('keeps an order that cannot be disputed from being disputed', async () => {
    const completed = build({ orderStatus: 'COMPLETED' });
    const created = await completed.service.createReport(REPORTER, {
      targetType: 'ORDER',
      targetId: ORDER_ID,
      reasonCode: 'PAYMENT_ISSUE',
    });

    // The order context owns its own state machine and says no.
    const failing = {
      ...completed,
      service: new ModerationService(
        completed.moderation,
        { record: async () => undefined } as unknown as AuditLogRepository,
        new FakeProviderProfileRepository(),
        new FakeServiceRepository({ findById: async () => null }),
        completed.reviews,
        {
          markDispute: async () => {
            throw orderInvalidState('Illegal order transition COMPLETED -> DISPUTED.');
          },
          findById: async () => completed.currentOrder,
        } as unknown as OrderService,
      ),
    };

    await expect(
      failing.service.resolveReport(ACTOR, created.reportId, {
        resolution: '转争议',
        action: 'DISPUTE_ORDER',
      }),
    ).rejects.toMatchObject({ code: 'ORDER_INVALID_STATE', status: 409 });
  });
});
