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
import { CONSOLE_CREDENTIAL_REPOSITORY } from '../../src/modules/auth/domain/console-credential.repository';
import {
  CONSOLE_PASSWORD_HASHER,
  ScryptPasswordHasher,
} from '../../src/modules/auth/domain/password-hasher';
import { PrismaConsoleCredentialRepository } from '../../src/modules/auth/infrastructure/prisma-console-credential.repository';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../src/modules/auth/http/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { ProviderDiscoveryService } from '../../src/modules/discovery/application/provider-discovery.service';
import { PROVIDER_DIRECTORY } from '../../src/modules/discovery/domain/provider-directory';
import { DiscoveryController } from '../../src/modules/discovery/http/discovery.controller';
import { PrismaProviderDirectory } from '../../src/modules/discovery/infrastructure/prisma-provider.directory';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { ComposedProviderReadinessGates } from '../../src/modules/provider/application/composed-provider-readiness.gates';
import { ProviderApplicationService } from '../../src/modules/provider/application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../src/modules/provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../src/modules/provider/domain/provider-profile.repository';
import {
  PROVIDER_READINESS_GATES,
  SERVICE_READINESS,
  VERIFICATION_READINESS,
} from '../../src/modules/provider/domain/provider-readiness.gates';
import { ProviderController } from '../../src/modules/provider/http/provider.controller';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { PrismaServiceReadiness } from '../../src/modules/services/infrastructure/prisma-service.readiness';
import { PrismaVerificationReadiness } from '../../src/modules/verification/infrastructure/prisma-verification-readiness';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T010 endpoints (`specs/05-api-spec.md` §Provider,
 * `specs/10-privacy-and-minors.md`, `specs/14-test-strategy.md` §API tests):
 *
 * - only discoverable providers are listed or shown;
 * - no private or workflow field ever reaches a public payload;
 * - filters, paging and validation behave as specified;
 * - route order: `GET /providers/me` still belongs to the provider context and
 *   is never parsed as a provider id.
 */
describeWithDatabase('discovery HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];
  const providerIds: string[] = [];

  const MATH = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  const ENGLISH = `T010_${randomUUID().replace(/-/g, '_').toUpperCase()}`;

  let visible: string;
  let hidden: string;
  let career: string;

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.taxonomyTerm.createMany({
      data: [
        { type: 'SUBJECT', code: MATH, name: '数学' },
        { type: 'SUBJECT', code: ENGLISH, name: '英语' },
      ],
    });

    visible = await newProvider({
      searchable: true,
      cityCode: 'BEIJING',
      providerType: 'TUTORING',
    });
    hidden = await newProvider({
      searchable: false,
      cityCode: 'BEIJING',
      providerType: 'TUTORING',
    });
    career = await newProvider({ searchable: true, cityCode: 'BEIJING', providerType: 'CAREER' });

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      // ProviderController before DiscoveryController: `/providers/me` must win
      // over `/providers/:id`.
      controllers: [AuthController, ProviderController, DiscoveryController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        RolesGuard,
        ProviderApplicationService,
        ProviderDiscoveryService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
        { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
        { provide: VERIFICATION_READINESS, useClass: PrismaVerificationReadiness },
        { provide: SERVICE_READINESS, useClass: PrismaServiceReadiness },
        { provide: PROVIDER_READINESS_GATES, useClass: ComposedProviderReadinessGates },
        { provide: PROVIDER_DIRECTORY, useClass: PrismaProviderDirectory },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'discovery-e2e-secret',
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
            openidPepper: 'discovery-e2e-pepper',
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
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerCapability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T010_' } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newProvider(options: {
    searchable: boolean;
    cityCode: string;
    providerType: 'TUTORING' | 'CAREER';
  }): Promise<string> {
    const user = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(user.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        providerType: options.providerType,
        publicName: '李老师',
        headline: '数学辅导',
        bio: '十年经验',
        avatarVisibility: 'PRIVATE',
        avatarAssetId: 'avatar-asset',
        cityCode: options.cityCode,
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: options.searchable,
        ratingAvg: 4.5,
        ratingCount: 12,
        completedOrderCount: 30,
      },
    });
    providerIds.push(provider.id);

    await prisma.providerCapability.create({
      data: {
        providerId: provider.id,
        capabilityType: options.providerType === 'CAREER' ? 'CAREER_MENTOR' : 'STUDENT_TUTOR',
        status: 'APPROVED',
        verificationLevel: 'FULL',
        complianceStatus: 'NOT_REQUIRED',
      },
    });

    const published = await prisma.service.create({
      data: {
        providerId: provider.id,
        domain: options.providerType,
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor: 20_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });
    // A draft must never be public, even for a discoverable provider.
    await prisma.service.create({
      data: {
        providerId: provider.id,
        domain: options.providerType,
        title: '草稿课',
        durationMinutes: 60,
        priceMinor: 5_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'DRAFT',
      },
    });

    const term = await prisma.taxonomyTerm.findFirst({
      where: { code: options.providerType === 'CAREER' ? ENGLISH : MATH },
      select: { id: true },
    });
    await prisma.serviceTerm.create({
      data: { serviceId: published.id, termId: term!.id },
    });

    return provider.id;
  }

  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function request<T>(
    method: 'GET',
    path: string,
    options: { token?: string } = {},
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  async function login(): Promise<string> {
    const response = await fetch(`${baseUrl}/auth/wechat/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: `t010-${randomUUID()}` }),
    });
    const payload = (await response.json()) as {
      data: { accessToken: string; user: { id: string } };
    };
    userIds.push(payload.data.user.id);
    return payload.data.accessToken;
  }

  it('lists discoverable providers to an anonymous caller', async () => {
    const response = await request<{
      data: {
        items: { id: string; publicName: string }[];
        total: number;
        page: number;
        pageSize: number;
      };
    }>('GET', '/providers');

    expect(response.status).toBe(200);
    const ids = response.body.data.items.map((item) => item.id);
    expect(ids).toContain(visible);
    expect(ids).not.toContain(hidden);
    // The career marketplace is flagged off in this database.
    expect(ids).not.toContain(career);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.pageSize).toBe(20);
  });

  it('never exposes a private or workflow field', async () => {
    const response = await request<{ data: { items: Record<string, unknown>[] } }>(
      'GET',
      '/providers',
    );

    const item = response.body.data.items[0]!;
    expect(Object.keys(item).sort()).toEqual(
      [
        'avatarAssetId',
        'bio',
        'capabilities',
        'cityCode',
        'completedOrderCount',
        'createdAt',
        'headline',
        'id',
        'minPriceMinor',
        'providerType',
        'publicName',
        'ratingAvg',
        'ratingCount',
        'serviceMode',
      ].sort(),
    );

    for (const forbidden of [
      'userId',
      'approvalStatus',
      'searchable',
      'avatarVisibility',
      'restrictionJson',
      'complianceStatus',
      'status',
      'phone',
      'wechatOpenidHash',
    ]) {
      expect(response.raw, forbidden).not.toContain(forbidden);
    }

    // A private photo stays private, and the capability payload is narrowed.
    expect(item.avatarAssetId).toBeNull();
    expect(item.capabilities).toEqual([
      { capabilityType: 'STUDENT_TUTOR', verificationLevel: 'FULL' },
    ]);
  });

  it('filters by city, subject, price, capability and verification', async () => {
    const city = await request<{ data: { items: { id: string }[]; total: number } }>(
      'GET',
      `/providers?city=${'beijing'}`,
    );
    expect(city.status).toBe(200);
    expect(city.body.data.items.map((item) => item.id)).toContain(visible);

    const subject = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      `/providers?subject=${MATH}`,
    );
    expect(subject.body.data.items.map((item) => item.id)).toEqual([visible]);

    const cheap = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?maxPrice=10000',
    );
    expect(cheap.body.data.items).toHaveLength(0);

    const affordable = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?minPrice=10000&maxPrice=30000',
    );
    expect(affordable.body.data.items.map((item) => item.id)).toEqual([visible]);

    const tutors = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?providerType=STUDENT_TUTOR',
    );
    expect(tutors.body.data.items.map((item) => item.id)).toEqual([visible]);

    const verified = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?verifiedOnly=true',
    );
    expect(verified.body.data.items.map((item) => item.id)).toEqual([visible]);
  });

  it('shows a discoverable provider with its published services only', async () => {
    const response = await request<{
      data: { id: string; services: { title: string; status: string }[] };
    }>('GET', `/providers/${visible}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(visible);
    expect(response.body.data.services).toHaveLength(1);
    expect(response.body.data.services[0]?.status).toBe('PUBLISHED');
    expect(response.raw).not.toContain('草稿课');

    const services = await request<{ data: { items: { status: string }[]; total: number } }>(
      'GET',
      `/providers/${visible}/services`,
    );
    expect(services.status).toBe(200);
    expect(services.body.data.total).toBe(1);
    expect(services.body.data.items[0]?.status).toBe('PUBLISHED');
  });

  it('answers NOT_FOUND for anything that is not discoverable', async () => {
    for (const path of [
      `/providers/${hidden}`,
      `/providers/${career}`,
      '/providers/22222222-2222-4222-8222-222222222222',
      '/providers/not-a-uuid',
    ]) {
      const response = await request<ErrorBody>('GET', path);
      expect(response.status, path).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }

    for (const path of [`/providers/${hidden}/services`, '/providers/not-a-uuid/services']) {
      const response = await request<ErrorBody>('GET', path);
      expect(response.status, path).toBe(404);
    }
  });

  it('rejects an invalid query', async () => {
    const invalid = [
      '/providers?pageSize=51',
      '/providers?page=0',
      '/providers?sort=cheapest',
      '/providers?minPrice=30000&maxPrice=10000',
      '/providers?city=%E5%8C%97%E4%BA%AC!',
      '/providers?domain=MEDICAL',
      '/providers?unknown=1',
    ];

    for (const path of invalid) {
      const response = await request<ErrorBody>('GET', path);
      expect(response.status, path).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('keeps /providers/me in the provider context', async () => {
    // Without a session it is AUTH_REQUIRED, never a provider id lookup.
    const anonymous = await request<ErrorBody>('GET', '/providers/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('AUTH_REQUIRED');

    const token = await login();
    const mine = await request<ErrorBody>('GET', '/providers/me', { token });
    expect(mine.status).toBe(404);
    expect(mine.body.error.code).toBe('NOT_FOUND');
  });

  it('hides the career marketplace while the flag is off', async () => {
    const careerList = await request<{ data: { items: unknown[]; total: number } }>(
      'GET',
      '/providers?domain=CAREER',
    );
    expect(careerList.status).toBe(200);
    expect(careerList.body.data.items).toHaveLength(0);
    expect(careerList.body.data.total).toBe(0);
  });
});
