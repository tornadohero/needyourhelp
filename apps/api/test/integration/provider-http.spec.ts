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
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { ProviderAdminService } from '../../src/modules/provider/application/provider-admin.service';
import { ProviderApplicationService } from '../../src/modules/provider/application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../src/modules/provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../src/modules/provider/domain/provider-profile.repository';
import { PROVIDER_READINESS_GATES } from '../../src/modules/provider/domain/provider-readiness.gates';
import { AdminProviderController } from '../../src/modules/provider/http/admin-provider.controller';
import { ProviderController } from '../../src/modules/provider/http/provider.controller';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T005 endpoints (`specs/05-api-spec.md` §Provider,
 * `specs/14-test-strategy.md` §API tests):
 *
 * - authenticated success, unauthenticated failure, wrong-role failure,
 *   invalid input;
 * - the publication gate: a provider cannot publish before approval;
 * - status fields (`approvalStatus`, `searchable`) are never client-controlled;
 * - admin decisions are audited.
 */
describeWithDatabase('provider HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let applications: ProviderApplicationService;
  let baseUrl: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, ProviderController, AdminProviderController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        ProviderApplicationService,
        ProviderAdminService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
        { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
        // The provider HTTP tests must not depend on the verification context:
        // the discovery gates are stubbed closed for the whole suite.
        {
          provide: PROVIDER_READINESS_GATES,
          useValue: {
            verificationSatisfied: async () => false,
            hasPublishedService: async () => false,
          },
        },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'provider-e2e-secret',
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
            openidPepper: 'provider-e2e-pepper',
            defaultRoles: ['USER'],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    applications = moduleRef.get(ProviderApplicationService);
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
      where: { OR: [{ actorUserId: { in: userIds } }, { resourceId: { in: userIds } }] },
    });
    await prisma.providerCapability.deleteMany({
      where: { provider: { userId: { in: userIds } } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  /** Register/login a fresh account through the real login endpoint. */
  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t005-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function makeAdmin(userId: string): Promise<void> {
    await prisma.userRole.upsert({
      where: { userId_role: { userId, role: 'ADMIN' } },
      create: { userId, role: 'ADMIN' },
      update: {},
    });
  }

  interface ProviderBody {
    data: {
      id: string;
      userId: string;
      providerType: string;
      publicName: string;
      approvalStatus: string;
      searchable: boolean;
      serviceMode: string;
      cityCode: string | null;
      capabilities: { capabilityType: string; status: string; complianceStatus: string }[];
    };
  }

  const APPLICATION = {
    publicName: '李老师',
    headline: '数学与物理辅导',
    cityCode: 'BEIJING',
    serviceMode: 'ONLINE',
    capabilityTypes: ['STUDENT_TUTOR', 'TEACHER'],
  } as const;

  it('rejects unauthenticated onboarding requests', async () => {
    const read = await request<ErrorBody>('GET', '/providers/me');
    expect(read.status).toBe(401);
    expect(read.body.error.code).toBe('AUTH_REQUIRED');

    const create = await request<ErrorBody>('POST', '/providers/applications', {
      body: APPLICATION,
    });
    expect(create.status).toBe(401);

    const submit = await request<ErrorBody>('POST', '/providers/me/submit');
    expect(submit.status).toBe(401);
  });

  it('creates a draft application with its capabilities (AT/E2E-02 step 1)', async () => {
    const { token } = await login();

    const created = await request<ProviderBody>('POST', '/providers/applications', {
      token,
      body: APPLICATION,
    });

    expect(created.status).toBe(201);
    expect(created.body.data.approvalStatus).toBe('DRAFT');
    expect(created.body.data.searchable).toBe(false);
    expect(created.body.data.cityCode).toBe('BEIJING');
    expect(created.body.data.capabilities).toHaveLength(2);
    expect(created.body.data.capabilities.every((c) => c.status === 'DRAFT')).toBe(true);
    // Teacher requires a compliance review, so it starts PENDING (T007 owns it).
    const teacher = created.body.data.capabilities.find((c) => c.capabilityType === 'TEACHER');
    expect(teacher?.complianceStatus).toBe('PENDING');
  });

  it('rejects invalid applications', async () => {
    const { token } = await login();

    const emptyCapabilities = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: { ...APPLICATION, capabilityTypes: [] },
    });
    expect(emptyCapabilities.status).toBe(400);
    expect(emptyCapabilities.body.error.code).toBe('VALIDATION_ERROR');

    const wrongDomain = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: { ...APPLICATION, capabilityTypes: ['CAREER_MENTOR'] },
    });
    expect(wrongDomain.status).toBe(400);

    const unknownType = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: { ...APPLICATION, providerType: 'ASTROLOGER' },
    });
    expect(unknownType.status).toBe(400);

    const badCity = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: { ...APPLICATION, cityCode: 'beijing city' },
    });
    expect(badCity.status).toBe(400);
  });

  it('rejects a second application of the same type', async () => {
    const { token } = await login();
    await request<ProviderBody>('POST', '/providers/applications', { token, body: APPLICATION });

    const second = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: APPLICATION,
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks a career application while the marketplace flag is off', async () => {
    const { token } = await login();

    const response = await request<ErrorBody>('POST', '/providers/applications', {
      token,
      body: {
        ...APPLICATION,
        providerType: 'CAREER',
        capabilityTypes: ['CAREER_MENTOR'],
      },
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('never lets the client set approval status or searchability', async () => {
    const { token } = await login();
    await request<ProviderBody>('POST', '/providers/applications', { token, body: APPLICATION });

    const selfApproval = await request<ErrorBody>('PATCH', '/providers/me', {
      token,
      body: { publicName: '改名', approvalStatus: 'APPROVED' },
    });
    expect(selfApproval.status).toBe(400);
    expect(selfApproval.body.error.code).toBe('VALIDATION_ERROR');

    const selfSearchable = await request<ErrorBody>('PATCH', '/providers/me', {
      token,
      body: { publicName: '改名', searchable: true },
    });
    expect(selfSearchable.status).toBe(400);

    const role = await request<ErrorBody>('PATCH', '/providers/me', {
      token,
      body: { publicName: '改名', role: 'PROVIDER' },
    });
    expect(role.status).toBe(400);

    // The untouched application is still a draft.
    const current = await request<ProviderBody>('GET', '/providers/me', { token });
    expect(current.body.data.approvalStatus).toBe('DRAFT');
    expect(current.body.data.searchable).toBe(false);
  });

  it('edits a draft application, then submits it', async () => {
    const { token } = await login();
    await request<ProviderBody>('POST', '/providers/applications', { token, body: APPLICATION });

    const updated = await request<ProviderBody>('PATCH', '/providers/me', {
      token,
      body: { publicName: '李老师（高级）', capabilityTypes: ['GRADUATE_TUTOR'] },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.publicName).toBe('李老师（高级）');
    expect(updated.body.data.capabilities.map((c) => c.capabilityType)).toEqual(['GRADUATE_TUTOR']);

    const submitted = await request<ProviderBody>('POST', '/providers/me/submit', { token });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.approvalStatus).toBe('SUBMITTED');

    // Under review: no more self-service edits, no second submission.
    const frozen = await request<ErrorBody>('PATCH', '/providers/me', {
      token,
      body: { publicName: '再改名' },
    });
    expect(frozen.status).toBe(400);

    const resubmit = await request<ErrorBody>('POST', '/providers/me/submit', { token });
    expect(resubmit.status).toBe(400);
  });

  it('blocks publishing until an admin approves (acceptance criterion)', async () => {
    const { token, userId } = await login();
    await request<ProviderBody>('POST', '/providers/applications', { token, body: APPLICATION });

    await expect(applications.assertCanPublish(userId)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
      status: 409,
    });

    await request<ProviderBody>('POST', '/providers/me/submit', { token });
    await expect(applications.assertCanPublish(userId)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_APPROVED',
    });

    const admin = await login();
    await makeAdmin(admin.userId);
    const mine = await request<ProviderBody>('GET', '/providers/me', { token });

    const approved = await request<ProviderBody>(
      'POST',
      `/admin/providers/${mine.body.data.id}/approve`,
      { token: admin.token, body: { reason: '材料齐全' } },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.data.approvalStatus).toBe('APPROVED');

    // Approved, but not yet discoverable: verification (T006) and a published
    // service (T009) are still missing.
    expect(approved.body.data.searchable).toBe(false);

    await expect(applications.assertCanPublish(userId)).resolves.toBeDefined();
  });

  it('grants the provider role on approval and audits the decision', async () => {
    const provider = await login();
    const created = await request<ProviderBody>('POST', '/providers/applications', {
      token: provider.token,
      body: APPLICATION,
    });
    await request<ProviderBody>('POST', '/providers/me/submit', { token: provider.token });

    const admin = await login();
    await makeAdmin(admin.userId);

    await request<ProviderBody>('POST', `/admin/providers/${created.body.data.id}/approve`, {
      token: admin.token,
      body: { reason: '通过' },
    });

    const me = await request<{ data: { roles: string[] } }>('GET', '/me', {
      token: provider.token,
    });
    expect(me.body.data.roles).toContain('PROVIDER');

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: 'provider_profile', resourceId: created.body.data.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe('PROVIDER_APPROVED');
    expect(auditRows[0]?.actorUserId).toBe(admin.userId);
    expect(auditRows[0]?.beforeJson).toMatchObject({ approvalStatus: 'SUBMITTED' });
    expect(auditRows[0]?.afterJson).toMatchObject({ approvalStatus: 'APPROVED' });
    expect(auditRows[0]?.requestId).toBeTruthy();
  });

  it('rejects an admin decision without the admin role', async () => {
    const provider = await login();
    const created = await request<ProviderBody>('POST', '/providers/applications', {
      token: provider.token,
      body: APPLICATION,
    });
    await request<ProviderBody>('POST', '/providers/me/submit', { token: provider.token });

    const response = await request<ErrorBody>(
      'POST',
      `/admin/providers/${created.body.data.id}/approve`,
      { token: provider.token, body: {} },
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');

    const unauthenticated = await request<ErrorBody>(
      'POST',
      `/admin/providers/${created.body.data.id}/approve`,
      { body: {} },
    );
    expect(unauthenticated.status).toBe(401);
  });

  it('requires a reason to reject and allows resubmission afterwards', async () => {
    const provider = await login();
    const created = await request<ProviderBody>('POST', '/providers/applications', {
      token: provider.token,
      body: APPLICATION,
    });
    await request<ProviderBody>('POST', '/providers/me/submit', { token: provider.token });

    const admin = await login();
    await makeAdmin(admin.userId);

    const withoutReason = await request<ErrorBody>(
      'POST',
      `/admin/providers/${created.body.data.id}/reject`,
      { token: admin.token, body: {} },
    );
    expect(withoutReason.status).toBe(400);
    expect(withoutReason.body.error.code).toBe('VALIDATION_ERROR');

    const rejected = await request<ProviderBody>(
      'POST',
      `/admin/providers/${created.body.data.id}/reject`,
      { token: admin.token, body: { reason: '学历证明不清晰' } },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.approvalStatus).toBe('REJECTED');

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: 'provider_profile', resourceId: created.body.data.id },
    });
    expect(auditRows[0]?.action).toBe('PROVIDER_REJECTED');
    expect(auditRows[0]?.afterJson).toMatchObject({ reason: '学历证明不清晰' });

    // Rejected applications can be edited and resubmitted.
    const edited = await request<ProviderBody>('PATCH', '/providers/me', {
      token: provider.token,
      body: { headline: '补充材料后重新提交' },
    });
    expect(edited.status).toBe(200);

    const resubmitted = await request<ProviderBody>('POST', '/providers/me/submit', {
      token: provider.token,
    });
    expect(resubmitted.body.data.approvalStatus).toBe('SUBMITTED');
  });

  it('returns NOT_FOUND for an unknown provider decision target', async () => {
    const admin = await login();
    await makeAdmin(admin.userId);

    const response = await request<ErrorBody>('POST', `/admin/providers/${randomUUID()}/approve`, {
      token: admin.token,
      body: {},
    });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
