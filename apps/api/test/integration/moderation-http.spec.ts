import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG } from '../../src/modules/auth/domain/auth.service';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { ModerationModule } from '../../src/modules/moderation/moderation.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T018 endpoints (`specs/05-api-spec.md` §Reports /
 * §Admin, `specs/06-verification-state-machine.md` §Moderation,
 * `specs/12-admin-spec.md`):
 *
 * - every admin action is audited;
 * - the appeal path is supported, and reviewed independently.
 */
describeWithDatabase('moderation HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  /** Built once: a paid order and a published review to moderate. */
  let orderId: string;
  let reviewId: string;
  let reportedUserId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        ModerationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'moderation-e2e-secret',
          ttlSeconds: 900,
          issuer: 'mentor-platform',
        }),
      )
      .overrideProvider(WECHAT_AUTH_PROVIDER)
      .useValue(new MockWeChatAuthProvider({ environment: 'test' }))
      .overrideProvider(AUTH_CONFIG)
      .useValue({
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 86_400,
        openidPepper: 'moderation-e2e-pepper',
        defaultRoles: ['USER'],
      })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${API_BASE}`;

    const reporter = await prisma.user.create({ data: { displayName: '家长', status: 'ACTIVE' } });
    const owner = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(reporter.id, owner.id);
    reportedUserId = owner.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: owner.id,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
      },
    });
    providerIds.push(provider.id);

    const service = await prisma.service.create({
      data: {
        providerId: provider.id,
        domain: 'TUTORING',
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor: 20_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNo: `MO-MOD-${randomUUID().slice(0, 8)}`,
        buyerUserId: reporter.id,
        providerId: provider.id,
        serviceId: service.id,
        domain: 'TUTORING',
        status: 'PAID',
        amountMinor: 20_000,
        platformFeeMinor: 2_000,
        providerAmountMinor: 18_000,
        currency: 'CNY',
        priceSnapshot: {
          serviceId: service.id,
          priceMinor: 20_000,
          title: '数学一对一',
          currency: 'CNY',
          durationMinutes: 60,
        },
        policySnapshot: {
          feeVersion: 'platform-fee-v1',
          feeRateBps: 1_000,
          cancellationPolicyId: null,
        },
      },
    });
    orderId = order.id;

    const review = await prisma.review.create({
      data: {
        orderId: order.id,
        reviewerUserId: reporter.id,
        revieweeUserId: owner.id,
        rating: 5,
        content: '很好',
        status: 'PUBLISHED',
      },
    });
    reviewId = review.id;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.auditLog.deleteMany({ where: { resourceType: 'moderation_case' } });
    await prisma.review.deleteMany({ where: { revieweeUserId: { in: userIds } } });
    await prisma.report.deleteMany({ where: { reporterUserId: { in: userIds } } });
    await prisma.moderationCase.deleteMany({
      where: { targetId: { in: [orderId, reviewId, reportedUserId] } },
    });
    await prisma.order.deleteMany({ where: { buyerUserId: { in: userIds } } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface ReportBody {
    data: { reportId: string; caseId: string; caseCreated: boolean };
  }

  interface ListBody {
    data: {
      items: {
        id: string;
        targetType: string;
        status: string;
        caseId: string | null;
        caseStatus: string | null;
      }[];
      total: number;
      page: number;
      pageSize: number;
    };
  }

  interface QueueBody {
    data: {
      items: {
        id: string;
        reporterUserId: string;
        caseStatus: string | null;
        resolution: string | null;
      }[];
      total: number;
    };
  }

  interface CaseBody {
    data: { id: string; status: string; decision: string | null; appealReason: string | null };
  }

  interface DecisionBody {
    data: {
      reportId: string;
      caseId: string;
      reportStatus: string;
      caseStatus: string;
      actionTaken: string;
    };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T }> {
    const hasBody = options.body !== undefined && method !== 'GET';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function login(code: string): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t018-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function loginAsAdmin(code: string): Promise<{ token: string; userId: string }> {
    const account = await login(code);
    await prisma.userRole.create({ data: { userId: account.userId, role: 'ADMIN' } });
    return account;
  }

  it('requires a session, and the admin role for the queue', async () => {
    const anonymous = await request<ErrorBody>('POST', '/reports', {
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER' },
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('AUTH_REQUIRED');

    const reporter = await login('reporter');

    const anonymousList = await request<ErrorBody>('GET', '/me/reports');
    expect(anonymousList.status).toBe(401);

    const forbiddenQueue = await request<ErrorBody>('GET', '/admin/reports', {
      token: reporter.token,
    });
    expect(forbiddenQueue.status).toBe(403);

    const anonymousResolve = await request<ErrorBody>(
      'POST',
      `/admin/reports/${randomUUID()}/resolve`,
      {
        body: { resolution: 'x' },
      },
    );
    expect(anonymousResolve.status).toBe(401);
  });

  it('takes a report, lists it for its author, and refuses bad intake', async () => {
    const reporter = await login('reporter-2');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: {
        targetType: 'USER',
        targetId: reportedUserId,
        reasonCode: 'HARASSMENT',
        description: '骚扰内容',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.caseCreated).toBe(true);

    const mine = await request<ListBody>('GET', '/me/reports', { token: reporter.token });
    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.items[0]).toMatchObject({
      targetType: 'USER',
      status: 'PENDING',
      caseId: created.body.data.caseId,
      caseStatus: 'OPEN',
    });

    for (const body of [
      { targetType: 'NOPE', targetId: reportedUserId, reasonCode: 'OTHER' },
      { targetType: 'USER', targetId: 'not-a-uuid', reasonCode: 'OTHER' },
      { targetType: 'USER', targetId: reportedUserId, reasonCode: 'MADE_UP' },
      {
        targetType: 'USER',
        targetId: reportedUserId,
        reasonCode: 'OTHER',
        description: 'x'.repeat(2001),
      },
      { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER', extra: 1 },
    ]) {
      const response = await request<ErrorBody>('POST', '/reports', {
        token: reporter.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('resolves a report with an audit row, and refuses to decide twice', async () => {
    const reporter = await login('reporter-3');
    const admin = await loginAsAdmin('admin-1');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'FRAUD' },
    });

    const resolved = await request<DecisionBody>(
      'POST',
      `/admin/reports/${created.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '已警告用户' } },
    );

    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({
      reportStatus: 'RESOLVED',
      caseStatus: 'RESOLVED',
      actionTaken: 'NO_ACTION',
    });

    // `specs/12-admin-spec.md`: audit every moderation action.
    const audit = await prisma.auditLog.findMany({
      where: { resourceType: 'moderation_case', resourceId: created.body.data.caseId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'MODERATION_RESOLVED', actorType: 'ADMIN' });

    const second = await request<ErrorBody>(
      'POST',
      `/admin/reports/${created.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '再来一次' } },
    );
    expect(second.status).toBe(400);

    // A decision without a reason is refused (`specs/12`: no silent data edits).
    const other = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER' },
    });
    const withoutReason = await request<ErrorBody>(
      'POST',
      `/admin/reports/${other.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '  ' } },
    );
    expect(withoutReason.status).toBe(400);
  });

  it('hides the review it decided to hide', async () => {
    const reporter = await login('reporter-4');
    const admin = await loginAsAdmin('admin-2');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'REVIEW', targetId: reviewId, reasonCode: 'INAPPROPRIATE_CONTENT' },
    });

    const resolved = await request<DecisionBody>(
      'POST',
      `/admin/reports/${created.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '内容违规', action: 'HIDE_REVIEW' } },
    );

    expect(resolved.body.data.actionTaken).toBe('HIDE_REVIEW');
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).status).toBe(
      'HIDDEN',
    );
  });

  it('disputes the order it decided to dispute', async () => {
    const reporter = await login('reporter-5');
    const admin = await loginAsAdmin('admin-3');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'ORDER', targetId: orderId, reasonCode: 'PAYMENT_ISSUE' },
    });

    const resolved = await request<DecisionBody>(
      'POST',
      `/admin/reports/${created.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '转争议处理', action: 'DISPUTE_ORDER' } },
    );

    expect(resolved.body.data.actionTaken).toBe('DISPUTE_ORDER');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'DISPUTED',
    );
  });

  it('refuses an action that does not belong to the target', async () => {
    const reporter = await login('reporter-6');
    const admin = await loginAsAdmin('admin-4');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER' },
    });

    const wrongAction = await request<ErrorBody>(
      'POST',
      `/admin/reports/${created.body.data.reportId}/resolve`,
      { token: admin.token, body: { resolution: '隐藏', action: 'HIDE_REVIEW' } },
    );
    expect(wrongAction.status).toBe(400);
    expect(wrongAction.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('walks the appeal path: filed by a party, finalized by another moderator', async () => {
    const reporter = await login('reporter-7');
    const decider = await loginAsAdmin('admin-5');
    const reviewer = await loginAsAdmin('admin-6');
    const stranger = await login('stranger');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'UNSAFE_BEHAVIOR' },
    });
    await request<DecisionBody>('POST', `/admin/reports/${created.body.data.reportId}/resolve`, {
      token: decider.token,
      body: { resolution: '暂停服务' },
    });

    // A stranger may not appeal somebody else's report.
    const byStranger = await request<ErrorBody>(
      'POST',
      `/reports/${created.body.data.reportId}/appeal`,
      {
        token: stranger.token,
        body: { reason: '不同意' },
      },
    );
    expect(byStranger.status).toBe(403);

    const appealed = await request<CaseBody>(
      'POST',
      `/reports/${created.body.data.reportId}/appeal`,
      { token: reporter.token, body: { reason: '我没有违规' } },
    );
    expect(appealed.status).toBe(200);
    expect(appealed.body.data).toMatchObject({ status: 'APPEALED', appealReason: '我没有违规' });

    // `specs/06`: the appeal is reviewed independently.
    const byDecider = await request<ErrorBody>(
      'POST',
      `/admin/moderation/${appealed.body.data.id}/finalize`,
      {
        token: decider.token,
        body: { decision: 'UPHELD', decisionReason: '维持原判' },
      },
    );
    expect(byDecider.status).toBe(400);
    expect(byDecider.body.error.message).toMatch(/somebody other than/);

    const finalized = await request<CaseBody>(
      'POST',
      `/admin/moderation/${appealed.body.data.id}/finalize`,
      { token: reviewer.token, body: { decision: 'UPHELD', decisionReason: '维持原判' } },
    );
    expect(finalized.status).toBe(200);
    expect(finalized.body.data).toMatchObject({ status: 'FINALIZED', decision: 'UPHELD' });

    const audits = await prisma.auditLog.findMany({
      where: { resourceType: 'moderation_case', resourceId: appealed.body.data.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((row) => row.action)).toEqual([
      'MODERATION_RESOLVED',
      'MODERATION_APPEAL_FILED',
      'MODERATION_APPEAL_FINALIZED',
    ]);
  });

  it('moves a case through the machine, audited, and never back', async () => {
    const reporter = await login('reporter-8');
    const admin = await loginAsAdmin('admin-7');

    const created = await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER' },
    });

    const investigating = await request<CaseBody>(
      'POST',
      `/admin/moderation/${created.body.data.caseId}/transition`,
      { token: admin.token, body: { status: 'INVESTIGATING', note: '联系双方' } },
    );
    expect(investigating.status).toBe(200);
    expect(investigating.body.data.status).toBe('INVESTIGATING');

    // A decided state belongs to the decision commands, not to a transition.
    const asResolved = await request<ErrorBody>(
      'POST',
      `/admin/moderation/${created.body.data.caseId}/transition`,
      { token: admin.token, body: { status: 'RESOLVED' } },
    );
    expect(asResolved.status).toBe(400);

    const audits = await prisma.auditLog.findMany({
      where: { resourceType: 'moderation_case', resourceId: created.body.data.caseId },
    });
    expect(audits.map((row) => row.action)).toContain('MODERATION_CASE_TRANSITIONED');
  });

  it('shows the queue to an admin only', async () => {
    const reporter = await login('reporter-9');
    const admin = await loginAsAdmin('admin-8');

    await request<ReportBody>('POST', '/reports', {
      token: reporter.token,
      body: { targetType: 'USER', targetId: reportedUserId, reasonCode: 'OTHER' },
    });

    const queue = await request<QueueBody>('GET', '/admin/reports', { token: admin.token });
    expect(queue.status).toBe(200);
    expect(queue.body.data.total).toBeGreaterThan(0);
    expect(queue.body.data.items[0]?.reporterUserId).toBeDefined();

    const open = await request<QueueBody>('GET', '/admin/reports?status=OPEN', {
      token: admin.token,
    });
    expect(open.status).toBe(200);

    const tooLarge = await request<ErrorBody>('GET', '/admin/reports?pageSize=51', {
      token: admin.token,
    });
    expect(tooLarge.status).toBe(400);
  });
});
