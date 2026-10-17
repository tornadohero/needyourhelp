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
import { PlatformModule } from '../../src/modules/platform/platform.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for platform configuration (`specs/05-api-spec.md` §Admin,
 * `specs/10-privacy-and-minors.md` §Platform rules, `specs/12-admin-spec.md`
 * §Audit): a flag change and a rule publication are audited, and a rule is
 * versioned — publishing archives the version it replaces.
 */
describeWithDatabase('platform configuration HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;

  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        PlatformModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'platform-e2e-secret',
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
        openidPepper: 'platform-e2e-pepper',
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
    await prisma.auditLog.deleteMany({
      where: { resourceType: { in: ['feature_flag', 'platform_rule'] } },
    });
    await prisma.platformRule.deleteMany({ where: { ruleType: 'test_refund_policy' } });
    await prisma.featureFlag.deleteMany({ where: { key: 'test_flag' } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface FlagListBody {
    data: { items: { key: string; enabled: boolean }[] };
  }

  interface FlagBody {
    data: { key: string; enabled: boolean };
  }

  interface RuleBody {
    data: {
      id: string;
      ruleType: string;
      version: string;
      status: string;
      contentRef: string;
      publishedAt: string | null;
    };
  }

  interface RuleListBody {
    data: { items: { id: string; version: string; status: string }[] };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
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
      { body: { code: `t019p-${code}-${randomUUID()}` } },
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

  it('keeps configuration behind the admin role', async () => {
    const customer = await login('customer');

    const anonymousFlags = await request<ErrorBody>('GET', '/admin/feature-flags');
    expect(anonymousFlags.status).toBe(401);

    const forbiddenFlags = await request<ErrorBody>('GET', '/admin/feature-flags', {
      token: customer.token,
    });
    expect(forbiddenFlags.status).toBe(403);

    const anonymousRules = await request<ErrorBody>('GET', '/admin/platform-rules');
    expect(anonymousRules.status).toBe(401);
  });

  it('lists flags and audits every change', async () => {
    const admin = await loginAsAdmin('admin-1');

    const listed = await request<FlagListBody>('GET', '/admin/feature-flags', {
      token: admin.token,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data.items.some((flag) => flag.key === 'test_flag')).toBe(false);

    // A flag that does not exist yet can be created: no database edit needed.
    const created = await request<FlagBody>('PATCH', '/admin/feature-flags/test_flag', {
      token: admin.token,
      body: { enabled: true },
    });
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ key: 'test_flag', enabled: true });

    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'feature_flag', resourceId: 'test_flag' },
    });
    expect(rows.map((row) => row.action)).toEqual(['FEATURE_FLAG_CHANGED']);
    expect(rows[0]).toMatchObject({ actorType: 'ADMIN', actorUserId: admin.userId });

    const listedAgain = await request<FlagListBody>('GET', '/admin/feature-flags', {
      token: admin.token,
    });
    expect(listedAgain.body.data.items.find((flag) => flag.key === 'test_flag')?.enabled).toBe(
      true,
    );

    const turnedOff = await request<FlagBody>('PATCH', '/admin/feature-flags/test_flag', {
      token: admin.token,
      body: { enabled: false },
    });
    expect(turnedOff.body.data.enabled).toBe(false);

    const invalid = await request<ErrorBody>('PATCH', '/admin/feature-flags/test_flag', {
      token: admin.token,
      body: { enabled: 'yes' },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('publishes a versioned rule and archives the one it replaces', async () => {
    const admin = await loginAsAdmin('admin-2');

    const first = await request<RuleBody>('POST', '/admin/platform-rules', {
      token: admin.token,
      body: {
        ruleType: 'test_refund_policy',
        version: 'v1',
        contentRef: 'https://example.org/rules/refund/v1',
      },
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ status: 'DRAFT', version: 'v1' });
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PLATFORM_RULE_CREATED' } }),
    ).toBeDefined();

    const published = await request<RuleBody>(
      'POST',
      `/admin/platform-rules/${first.body.data.id}/publish`,
      { token: admin.token, body: {} },
    );
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('PUBLISHED');
    expect(published.body.data.publishedAt).not.toBeNull();

    const second = await request<RuleBody>('POST', '/admin/platform-rules', {
      token: admin.token,
      body: {
        ruleType: 'test_refund_policy',
        version: 'v2',
        contentRef: 'https://example.org/rules/refund/v2',
      },
    });
    await request<RuleBody>(`POST`, `/admin/platform-rules/${second.body.data.id}/publish`, {
      token: admin.token,
      body: {},
    });

    // What users were told before is archived, never rewritten (`specs/10`).
    expect(
      (await prisma.platformRule.findUniqueOrThrow({ where: { id: first.body.data.id } })).status,
    ).toBe('ARCHIVED');
    expect(
      await prisma.platformRule.findFirst({
        where: { ruleType: 'test_refund_policy', status: 'PUBLISHED' },
      }),
    ).toMatchObject({ version: 'v2' });

    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'platform_rule', action: 'PLATFORM_RULE_PUBLISHED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.afterJson).toMatchObject({ published: 'v2' });

    // Publishing twice is refused, and an unknown rule is not found.
    const twice = await request<ErrorBody>(
      'POST',
      `/admin/platform-rules/${second.body.data.id}/publish`,
      { token: admin.token, body: {} },
    );
    expect(twice.status).toBe(400);

    const missing = await request<ErrorBody>(
      'POST',
      '/admin/platform-rules/22222222-2222-4222-8222-222222222222/publish',
      { token: admin.token, body: {} },
    );
    expect(missing.status).toBe(404);
  });

  it('refuses an invalid rule and lists rules by type', async () => {
    const admin = await loginAsAdmin('admin-3');

    for (const body of [
      { ruleType: 'Refund Policy', version: 'v1', contentRef: 'x' },
      { ruleType: 'test_refund_policy', version: '', contentRef: 'x' },
      { ruleType: 'test_refund_policy', version: 'v1', contentRef: '  ' },
      { ruleType: 'test_refund_policy', version: 'v1', contentRef: 'x', effectiveAt: 'not-a-date' },
      { ruleType: 'test_refund_policy', version: 'v1', contentRef: 'x', extra: 1 },
    ]) {
      const response = await request<ErrorBody>('POST', '/admin/platform-rules', {
        token: admin.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    const rules = await request<RuleListBody>(
      'GET',
      '/admin/platform-rules?ruleType=test_refund_policy',
      { token: admin.token },
    );
    expect(rules.status).toBe(200);
    expect(rules.body.data.items.every((rule) => rule.version.startsWith('v'))).toBe(true);
  });
});
