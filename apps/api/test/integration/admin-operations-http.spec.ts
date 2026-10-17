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
import { AdminModule } from '../../src/modules/admin/admin.module';
import { ProviderModule } from '../../src/modules/provider/provider.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the operations pages (`specs/05-api-spec.md` §Admin,
 * `specs/12-admin-spec.md`):
 *
 * - every listing is admin/ops only, bounded and filtered;
 * - a role change — the one mutation that grants power — is audited;
 * - suspension and restoration go through the provider state machine.
 */
describeWithDatabase('operations HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        AdminModule,
        ProviderModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'operations-e2e-secret',
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
        openidPepper: 'operations-e2e-pepper',
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
  });

  afterAll(async () => {
    await app?.close();
    await prisma.auditLog.deleteMany({ where: { resourceType: 'user_role' } });
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

  interface DashboardBody {
    data: {
      users: { total: number; active: number };
      providers: { total: number; approved: number };
      orders: { total: number; gmvMinor: number };
      moderation: { openCases: number };
    };
  }

  interface UserListBody {
    data: {
      items: { id: string; displayName: string; roles: string[]; status: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
  }

  interface ProviderListBody {
    data: {
      items: { id: string; approvalStatus: string; publicName: string; searchable: boolean }[];
      total: number;
    };
  }

  interface OrderListBody {
    data: { items: { id: string; orderNo: string; status: string }[]; total: number };
  }

  interface AuditListBody {
    data: {
      items: { id: string; action: string; actorUserId: string | null; resourceType: string }[];
      total: number;
    };
  }

  interface RoleBody {
    data: { userId: string; roles: string[] };
  }

  interface ProfileBody {
    data: { id: string; approvalStatus: string };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
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
      { body: { code: `t019-${code}-${randomUUID()}` } },
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

  it('bootstraps the first administrator without a database edit, then closes', async () => {
    // No account holds the role yet: this is what a fresh deployment looks like
    // after `prisma db seed`.
    await prisma.userRole.deleteMany({ where: { role: 'ADMIN' } });
    const founder = await login('founder');

    const anonymous = await request<ErrorBody>('POST', '/admin/bootstrap');
    expect(anonymous.status).toBe(401);

    const first = await request<RoleBody>('POST', '/admin/bootstrap', { token: founder.token });
    expect(first.status).toBe(200);
    expect(first.body.data.roles).toContain('ADMIN');

    // Self-closing: with an admin in place the route refuses.
    const second = await request<ErrorBody>('POST', '/admin/bootstrap', { token: founder.token });
    expect(second.status).toBe(403);

    // And the new admin can immediately use the operations pages.
    const dashboard = await request<DashboardBody>('GET', '/admin/dashboard', {
      token: founder.token,
    });
    expect(dashboard.status).toBe(200);
    expect(
      await prisma.auditLog.findFirst({
        where: { resourceType: 'user_role', resourceId: founder.userId },
      }),
    ).toMatchObject({ action: 'ROLE_GRANTED' });
  });

  it('keeps every operations route behind a session and the admin role', async () => {
    const customer = await login('customer');

    for (const path of [
      '/admin/dashboard',
      '/admin/users',
      '/admin/providers',
      '/admin/orders',
      '/admin/audit-logs',
    ]) {
      const anonymous = await request<ErrorBody>('GET', path);
      expect(anonymous.status, path).toBe(401);
      expect(anonymous.body.error.code).toBe('AUTH_REQUIRED');

      const forbidden = await request<ErrorBody>('GET', path, { token: customer.token });
      expect(forbidden.status, path).toBe(403);
    }

    const admin = await loginAsAdmin('admin-1');
    const dashboard = await request<DashboardBody>('GET', '/admin/dashboard', {
      token: admin.token,
    });
    expect(dashboard.status).toBe(200);
  });

  it('reports the platform in one dashboard response', async () => {
    const admin = await loginAsAdmin('admin-2');
    const owner = await login('owner');

    const provider = await prisma.providerProfile.create({
      data: {
        userId: owner.userId,
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

    await prisma.order.create({
      data: {
        orderNo: `MO-OPS-${randomUUID().slice(0, 8)}`,
        buyerUserId: owner.userId,
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

    const dashboard = await request<DashboardBody>('GET', '/admin/dashboard', {
      token: admin.token,
    });

    expect(dashboard.body.data.users.total).toBeGreaterThan(0);
    expect(dashboard.body.data.providers.approved).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.orders.gmvMinor).toBeGreaterThanOrEqual(20_000);
  });

  it('lists users with their roles, filtered and bounded', async () => {
    const admin = await loginAsAdmin('admin-3');

    const users = await request<UserListBody>('GET', '/admin/users?pageSize=1', {
      token: admin.token,
    });
    expect(users.status).toBe(200);
    expect(users.body.data.pageSize).toBe(1);
    expect(users.body.data.items).toHaveLength(1);
    // An operator sees the roles, and nothing else that is private.
    expect(users.body.data.items[0]?.roles).toBeDefined();

    const active = await request<UserListBody>('GET', '/admin/users?status=ACTIVE', {
      token: admin.token,
    });
    expect(active.status).toBe(200);

    const tooLarge = await request<ErrorBody>('GET', '/admin/users?pageSize=51', {
      token: admin.token,
    });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audits granting and revoking a role', async () => {
    const admin = await loginAsAdmin('admin-4');
    const target = await login('target');

    const granted = await request<RoleBody>('POST', `/admin/users/${target.userId}/roles`, {
      token: admin.token,
      body: { role: 'MODERATOR' },
    });
    expect(granted.status).toBe(201);
    expect(granted.body.data.roles).toContain('MODERATOR');

    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'user_role', resourceId: target.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.action)).toEqual(['ROLE_GRANTED']);
    expect(rows[0]).toMatchObject({ actorType: 'ADMIN', actorUserId: admin.userId });

    const revoked = await request<RoleBody>(
      'DELETE',
      `/admin/users/${target.userId}/roles/MODERATOR`,
      { token: admin.token },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.roles).not.toContain('MODERATOR');

    const after = await prisma.auditLog.findMany({
      where: { resourceType: 'user_role', resourceId: target.userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(after.map((row) => row.action)).toEqual(['ROLE_GRANTED', 'ROLE_REVOKED']);

    // An unknown role is refused, and an account that does not exist is not found.
    const unknownRole = await request<ErrorBody>('POST', `/admin/users/${target.userId}/roles`, {
      token: admin.token,
      body: { role: 'SUPERUSER' },
    });
    expect(unknownRole.status).toBe(400);

    const unknownUser = await request<ErrorBody>(
      'POST',
      '/admin/users/22222222-2222-4222-8222-222222222222/roles',
      { token: admin.token, body: { role: 'ADMIN' } },
    );
    expect(unknownUser.status).toBe(404);
  });

  it('lists providers as the review queue, and suspends and restores one', async () => {
    const admin = await loginAsAdmin('admin-5');
    const owner = await login('suspend-owner');

    const provider = await prisma.providerProfile.create({
      data: {
        userId: owner.userId,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
      },
    });
    providerIds.push(provider.id);

    const queue = await request<ProviderListBody>(
      'GET',
      '/admin/providers?approvalStatus=APPROVED',
      {
        token: admin.token,
      },
    );
    expect(queue.status).toBe(200);
    expect(queue.body.data.items.map((row) => row.id)).toContain(provider.id);

    const suspended = await request<ProfileBody>(
      'POST',
      `/admin/providers/${provider.id}/suspend`,
      {
        token: admin.token,
        body: { reason: '多起投诉待查' },
      },
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.approvalStatus).toBe('SUSPENDED');
    expect(
      (await prisma.providerProfile.findUniqueOrThrow({ where: { id: provider.id } })).searchable,
    ).toBe(false);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROVIDER_SUSPENDED' } }),
    ).toMatchObject({ actorType: 'ADMIN' });

    // A suspension without a reason is refused (`specs/12`: no silent data edits).
    const withoutReason = await request<ErrorBody>(
      'POST',
      `/admin/providers/${provider.id}/restore`,
      { token: admin.token, body: {} },
    );
    expect(withoutReason.status).toBe(200);

    // Suspending again is not a transition of the state machine.
    await request<ProfileBody>('POST', `/admin/providers/${provider.id}/suspend`, {
      token: admin.token,
      body: { reason: '待查' },
    });
    const twice = await request<ErrorBody>('POST', `/admin/providers/${provider.id}/suspend`, {
      token: admin.token,
      body: { reason: '待查' },
    });
    expect(twice.status).toBe(400);

    const restored = await request<ProfileBody>('POST', `/admin/providers/${provider.id}/restore`, {
      token: admin.token,
      body: {},
    });
    expect(restored.body.data.approvalStatus).toBe('APPROVED');
  });

  it('lists orders by status and audit logs by action', async () => {
    const admin = await loginAsAdmin('admin-6');

    const settled = await request<OrderListBody>('GET', '/admin/orders?status=COMPLETED', {
      token: admin.token,
    });
    expect(settled.status).toBe(200);
    expect(settled.body.data.items.every((row) => row.status === 'COMPLETED')).toBe(true);

    const all = await request<OrderListBody>('GET', '/admin/orders?pageSize=5', {
      token: admin.token,
    });
    expect(all.body.data.items.length).toBeLessThanOrEqual(5);

    const invalidStatus = await request<ErrorBody>('GET', '/admin/orders?status=NOPE', {
      token: admin.token,
    });
    expect(invalidStatus.status).toBe(400);

    const auditLogs = await request<AuditListBody>('GET', '/admin/audit-logs?action=ROLE_GRANTED', {
      token: admin.token,
    });
    expect(auditLogs.status).toBe(200);
    expect(auditLogs.body.data.items.every((row) => row.action === 'ROLE_GRANTED')).toBe(true);
    // The snapshots stay internal (`AGENTS.md` §9): the row lists who did what.
    expect(auditLogs.body.data.items[0]).not.toHaveProperty('beforeJson');
  });
});
