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
import { AUTH_CONFIG, AUTH_SERVICE, AuthService } from '../../src/modules/auth/domain/auth.service';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { TAXONOMY_REPOSITORY } from '../../src/modules/catalog/domain/taxonomy.repository';
import { PrismaTaxonomyRepository } from '../../src/modules/catalog/infrastructure/prisma-taxonomy.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { ComposedProviderReadinessGates } from '../../src/modules/provider/application/composed-provider-readiness.gates';
import { ProviderAdminService } from '../../src/modules/provider/application/provider-admin.service';
import { ProviderApplicationService } from '../../src/modules/provider/application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../src/modules/provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../src/modules/provider/domain/provider-profile.repository';
import {
  PROVIDER_READINESS_GATES,
  SERVICE_READINESS,
  VERIFICATION_READINESS,
} from '../../src/modules/provider/domain/provider-readiness.gates';
import { AdminProviderController } from '../../src/modules/provider/http/admin-provider.controller';
import { ProviderController } from '../../src/modules/provider/http/provider.controller';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { ProviderServiceService } from '../../src/modules/services/application/provider-service.service';
import { SERVICE_REPOSITORY } from '../../src/modules/services/domain/service.repository';
import { ProviderServiceController } from '../../src/modules/services/http/provider-service.controller';
import { PrismaServiceRepository } from '../../src/modules/services/infrastructure/prisma-service.repository';
import { PrismaServiceReadiness } from '../../src/modules/services/infrastructure/prisma-service.readiness';
import { PrismaVerificationReadiness } from '../../src/modules/verification/infrastructure/prisma-verification-readiness';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T009 endpoints (`specs/05-api-spec.md` §Services,
 * `specs/14-test-strategy.md` §API tests, E2E-02):
 *
 * - authenticated success, unauthenticated failure, invalid input, unknown
 *   target and another provider's service;
 * - price and duration are validated by the server;
 * - the publication state machine: publish requires an approved provider, a
 *   repeated publish is refused, editing a published service is refused, and
 *   unpublishing takes the provider out of discovery.
 */
describeWithDatabase('provider service HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];

  /** Taxonomy codes used by this suite; the integration DB is unseeded. */
  const SUBJECT = `T009_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const OTHER_SUBJECT = `T009_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const GRADE = `T009_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const CITY = `T009_${randomUUID().replace(/-/g, '_').toUpperCase()}`;

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.taxonomyTerm.createMany({
      data: [
        { type: 'SUBJECT', code: SUBJECT, name: '数学' },
        { type: 'SUBJECT', code: OTHER_SUBJECT, name: '物理' },
        { type: 'GRADE', code: GRADE, name: '小学一年级' },
        { type: 'CITY', code: CITY, name: '北京' },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [
        AuthController,
        ProviderController,
        AdminProviderController,
        ProviderServiceController,
      ],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        ProviderApplicationService,
        ProviderAdminService,
        ProviderServiceService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
        { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
        { provide: TAXONOMY_REPOSITORY, useClass: PrismaTaxonomyRepository },
        { provide: SERVICE_REPOSITORY, useClass: PrismaServiceRepository },
        // The real gates: verification (T006) and published services (T009).
        { provide: VERIFICATION_READINESS, useClass: PrismaVerificationReadiness },
        { provide: SERVICE_READINESS, useClass: PrismaServiceReadiness },
        { provide: PROVIDER_READINESS_GATES, useClass: ComposedProviderReadinessGates },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'services-e2e-secret',
            ttlSeconds: 900,
            issuer: 'mentor-platform',
          }),
        },
        {
          provide: WECHAT_AUTH_PROVIDER,
          useValue: new MockWeChatAuthProvider({ environment: 'test' }),
        },
        {
          provide: AUTH_CONFIG,
          useValue: {
            accessTokenTtlSeconds: 900,
            refreshTokenTtlSeconds: 86_400,
            openidPepper: 'services-e2e-pepper',
            defaultRoles: ['USER'],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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
    await prisma.service.deleteMany({ where: { provider: { userId: { in: userIds } } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.verificationCase.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerCapability.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T009_' } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface ServiceBody {
    data: {
      id: string;
      providerId: string;
      domain: string;
      title: string;
      description: string | null;
      durationMinutes: number;
      priceMinor: number;
      currency: string;
      deliveryMode: string;
      status: string;
      terms: { termId: string; type: string; code: string }[];
    };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t009-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function loginAsAdmin(): Promise<{ token: string; userId: string }> {
    const account = await login();
    await prisma.userRole.upsert({
      where: { userId_role: { userId: account.userId, role: 'ADMIN' } },
      create: { userId: account.userId, role: 'ADMIN' },
      update: {},
    });
    return account;
  }

  /** A tutoring provider application; returns the provider profile id. */
  async function becomeProvider(token: string): Promise<string> {
    const response = await request<{ data: { id: string } }>('POST', '/providers/applications', {
      token,
      body: { publicName: '李老师', capabilityTypes: ['STUDENT_TUTOR'] },
    });
    expect(response.status).toBe(201);
    return response.body.data.id;
  }

  /** `POST /providers/me/submit`: DRAFT -> SUBMITTED, the step before review. */
  async function submitApplication(token: string): Promise<void> {
    const response = await request<{ data: { approvalStatus: string } }>(
      'POST',
      '/providers/me/submit',
      { token },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.approvalStatus).toBe('SUBMITTED');
  }

  /** Admin decision: the only way to become approved (T005). */
  async function approveProvider(admin: string, providerId: string): Promise<void> {
    const response = await request<{ data: { approvalStatus: string } }>(
      'POST',
      `/admin/providers/${providerId}/approve`,
      { token: admin, body: { reason: '材料齐全' } },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.approvalStatus).toBe('APPROVED');
  }

  /** The verification gate (T006) still has to open for `searchable`. */
  async function approveVerifications(providerId: string): Promise<void> {
    await prisma.verificationCase.createMany({
      data: (['IDENTITY', 'EDUCATION'] as const).map((verificationType) => ({
        providerId,
        verificationType,
        status: 'APPROVED',
        reviewedAt: new Date(),
      })),
    });
  }

  const validService = (overrides: Record<string, unknown> = {}) => ({
    title: '数学一对一',
    durationMinutes: 60,
    priceMinor: 20_000,
    subjectCodes: [SUBJECT],
    ...overrides,
  });

  it('rejects unauthenticated service requests', async () => {
    const paths: ['GET' | 'POST' | 'PATCH', string][] = [
      ['GET', '/providers/me/services'],
      ['POST', '/providers/me/services'],
      ['PATCH', `/providers/me/services/${randomUUID()}`],
      ['POST', `/providers/me/services/${randomUUID()}/publish`],
      ['POST', `/providers/me/services/${randomUUID()}/unpublish`],
    ];

    for (const [method, path] of paths) {
      const response = await request<ErrorBody>(method, path, {
        ...(method === 'GET' ? {} : { body: {} }),
      });
      expect(response.status, path).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    }
  });

  it('creates a draft service and resolves its tags', async () => {
    const account = await login();
    await becomeProvider(account.token);

    const created = await request<ServiceBody>('POST', '/providers/me/services', {
      token: account.token,
      body: validService({ description: '小学段', gradeCodes: [GRADE], cityCodes: [CITY] }),
    });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.domain).toBe('TUTORING');
    expect(created.body.data.currency).toBe('CNY');
    expect(created.body.data.deliveryMode).toBe('ONLINE');
    expect(created.body.data.terms.map((term) => `${term.type}:${term.code}`).sort()).toEqual([
      `CITY:${CITY}`,
      `GRADE:${GRADE}`,
      `SUBJECT:${SUBJECT}`,
    ]);

    const stored = await prisma.service.findUnique({ where: { id: created.body.data.id } });
    expect(stored?.priceMinor).toBe(20_000);
    expect(stored?.durationMinutes).toBe(60);
    // Nothing private or server-owned leaks into the payload.
    expect(created.raw).not.toContain('cancellationPolicyId');
  });

  it('validates price, duration and tags server-side', async () => {
    const account = await login();
    await becomeProvider(account.token);

    const invalid: Record<string, unknown>[] = [
      { priceMinor: 0 },
      { priceMinor: 99 },
      { priceMinor: 20_000.5 },
      { priceMinor: 1_000_001 },
      { durationMinutes: 0 },
      { durationMinutes: 10 },
      { durationMinutes: 481 },
      { durationMinutes: 45.5 },
      { title: '   ' },
      { currency: 'CN' },
      { subjectCodes: ['NOT_A_CODE'] },
      { subjectCodes: undefined },
      { status: 'PUBLISHED' },
    ];

    for (const overrides of invalid) {
      const response = await request<ErrorBody>('POST', '/providers/me/services', {
        token: account.token,
        body: validService(overrides),
      });
      expect(response.status, JSON.stringify(overrides)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses to create a service without a provider application', async () => {
    const account = await login();

    const response = await request<ErrorBody>('POST', '/providers/me/services', {
      token: account.token,
      body: validService(),
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('lists, edits and refuses unknown or foreign services', async () => {
    const owner = await login();
    await becomeProvider(owner.token);
    const created = await request<ServiceBody>('POST', '/providers/me/services', {
      token: owner.token,
      body: validService(),
    });
    await request<ServiceBody>('POST', '/providers/me/services', {
      token: owner.token,
      body: validService({ title: '物理一对一', subjectCodes: [OTHER_SUBJECT] }),
    });

    const list = await request<{ data: { items: { id: string }[]; total: number } }>(
      'GET',
      '/providers/me/services',
      { token: owner.token },
    );
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(2);

    const patched = await request<ServiceBody>(
      'PATCH',
      `/providers/me/services/${created.body.data.id}`,
      { token: owner.token, body: { priceMinor: 25_000, title: '数学提高班' } },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.data.priceMinor).toBe(25_000);
    expect(patched.body.data.title).toBe('数学提高班');

    const foreign = await login();
    await becomeProvider(foreign.token);
    const foreignPatch = await request<ErrorBody>(
      'PATCH',
      `/providers/me/services/${created.body.data.id}`,
      { token: foreign.token, body: { priceMinor: 30_000 } },
    );
    expect(foreignPatch.status).toBe(403);
    expect(foreignPatch.body.error.code).toBe('FORBIDDEN');

    for (const id of [randomUUID(), 'not-a-uuid']) {
      const unknown = await request<ErrorBody>('PATCH', `/providers/me/services/${id}`, {
        token: owner.token,
        body: { title: 'x' },
      });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('publishes only an approved provider, and only once', async () => {
    const account = await login();
    const providerId = await becomeProvider(account.token);
    const created = await request<ServiceBody>('POST', '/providers/me/services', {
      token: account.token,
      body: validService(),
    });

    // T005 gate: no publishing before approval.
    const tooEarly = await request<ErrorBody>(
      'POST',
      `/providers/me/services/${created.body.data.id}/publish`,
      { token: account.token },
    );
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('PROVIDER_NOT_APPROVED');

    // Submit first: an admin can only decide a submitted application.
    await submitApplication(account.token);

    const admin = await loginAsAdmin();
    await approveProvider(admin.token, providerId);
    await approveVerifications(providerId);

    const published = await request<ServiceBody>(
      'POST',
      `/providers/me/services/${created.body.data.id}/publish`,
      { token: account.token },
    );
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('PUBLISHED');

    // E2E-02: approved + verified + published service => discoverable.
    const profile = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    expect(profile?.searchable).toBe(true);

    // A published service is not edited silently.
    const edit = await request<ErrorBody>(
      'PATCH',
      `/providers/me/services/${created.body.data.id}`,
      { token: account.token, body: { priceMinor: 1_000 } },
    );
    expect(edit.status).toBe(400);
    expect(edit.body.error.code).toBe('VALIDATION_ERROR');

    // Publishing twice is not a transition.
    const again = await request<ErrorBody>(
      'POST',
      `/providers/me/services/${created.body.data.id}/publish`,
      { token: account.token },
    );
    expect(again.status).toBe(400);

    const unpublished = await request<ServiceBody>(
      'POST',
      `/providers/me/services/${created.body.data.id}/unpublish`,
      { token: account.token },
    );
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.data.status).toBe('UNPUBLISHED');

    const hidden = await prisma.providerProfile.findUnique({ where: { id: providerId } });
    expect(hidden?.searchable).toBe(false);

    // Unpublishing a draft is not a transition either.
    const draft = await request<ServiceBody>('POST', '/providers/me/services', {
      token: account.token,
      body: validService({ title: '草稿课' }),
    });
    const illegal = await request<ErrorBody>(
      'POST',
      `/providers/me/services/${draft.body.data.id}/unpublish`,
      { token: account.token },
    );
    expect(illegal.status).toBe(400);
  });
});
