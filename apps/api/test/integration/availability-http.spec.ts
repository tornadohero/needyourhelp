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
import { OptionalJwtAuthGuard } from '../../src/modules/auth/http/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { ProviderApplicationService } from '../../src/modules/provider/application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../src/modules/provider/domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from '../../src/modules/provider/domain/provider-profile.repository';
import { PROVIDER_READINESS_GATES } from '../../src/modules/provider/domain/provider-readiness.gates';
import { ProviderController } from '../../src/modules/provider/http/provider.controller';
import { PrismaProviderCapabilityRepository } from '../../src/modules/provider/infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from '../../src/modules/provider/infrastructure/prisma-provider-profile.repository';
import { AvailabilityService } from '../../src/modules/availability/application/availability.service';
import { AVAILABILITY_SLOT_REPOSITORY } from '../../src/modules/availability/domain/availability-slot.repository';
import { AvailabilityController } from '../../src/modules/availability/http/availability.controller';
import { PrismaAvailabilitySlotRepository } from '../../src/modules/availability/infrastructure/prisma-availability-slot.repository';
import { PROVIDER_DIRECTORY } from '../../src/modules/discovery/domain/provider-directory';
import { PrismaProviderDirectory } from '../../src/modules/discovery/infrastructure/prisma-provider.directory';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T011 endpoints (`specs/05-api-spec.md`
 * §Availability, `specs/14-test-strategy.md` §API tests):
 *
 * - self-service create/delete need a session, the public listing does not;
 * - every window is validated server-side and overlaps are refused;
 * - a booked or past slot is never listed, a booked slot is never deleted;
 * - another provider's slot is `FORBIDDEN`, an unknown one `NOT_FOUND`.
 */
describeWithDatabase('availability HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  let slots: PrismaAvailabilitySlotRepository;
  const userIds: string[] = [];
  const providerIds: string[] = [];

  let visible: string;
  let hidden: string;

  beforeAll(async () => {
    await prisma.$connect();
    slots = new PrismaAvailabilitySlotRepository(prisma);
    visible = await newProvider({ searchable: true });
    hidden = await newProvider({ searchable: false });

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, ProviderController, AvailabilityController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        OptionalJwtAuthGuard,
        RolesGuard,
        ProviderApplicationService,
        AvailabilityService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
        { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
        { provide: PROVIDER_DIRECTORY, useClass: PrismaProviderDirectory },
        { provide: AVAILABILITY_SLOT_REPOSITORY, useClass: PrismaAvailabilitySlotRepository },
        {
          provide: PROVIDER_READINESS_GATES,
          useValue: {
            verificationSatisfied: async () => true,
            hasPublishedService: async () => true,
          },
        },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'availability-e2e-secret',
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
            openidPepper: 'availability-e2e-pepper',
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
    await prisma.availabilitySlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newProvider(options: { searchable: boolean }): Promise<string> {
    const user = await prisma.user.create({ data: { displayName: '老师', status: 'ACTIVE' } });
    userIds.push(user.id);
    const provider = await prisma.providerProfile.create({
      data: {
        userId: user.id,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: options.searchable,
      },
    });
    providerIds.push(provider.id);
    return provider.id;
  }

  /** A provider profile for the logged-in account, through the real API. */
  async function becomeProvider(token: string): Promise<string> {
    const response = await request<{ data: { id: string } }>('POST', '/providers/applications', {
      token,
      body: { publicName: '李老师', capabilityTypes: ['STUDENT_TUTOR'] },
    });
    expect(response.status).toBe(201);
    return response.body.data.id;
  }

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface SlotBody {
    data: {
      id: string;
      providerId: string;
      startAt: string;
      endAt: string;
      recurrenceRule: string | null;
      status: string;
    };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
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

  async function login(): Promise<string> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t011-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return response.body.data.accessToken;
  }

  function window(startMinutes: number, endMinutes: number) {
    const base = Date.now();
    return {
      startAt: new Date(base + startMinutes * 60_000).toISOString(),
      endAt: new Date(base + endMinutes * 60_000).toISOString(),
    };
  }

  it('requires a session for the self-service routes only', async () => {
    const created = await request<ErrorBody>('POST', '/providers/me/availability', {
      body: window(60, 120),
    });
    expect(created.status).toBe(401);
    expect(created.body.error.code).toBe('AUTH_REQUIRED');

    const removed = await request<ErrorBody>(
      'DELETE',
      `/providers/me/availability/${randomUUID()}`,
    );
    expect(removed.status).toBe(401);

    // Reading a provider's availability is public, like the rest of discovery.
    const listed = await request<{ data: { items: unknown[]; total: number } }>(
      'GET',
      `/providers/${visible}/availability`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data.items).toHaveLength(0);
  });

  it('creates a slot for the provider behind the session', async () => {
    const token = await login();
    await becomeProvider(token);
    const providerId = (await request<{ data: { id: string } }>('GET', '/providers/me', { token }))
      .body.data.id;

    const created = await request<SlotBody>('POST', '/providers/me/availability', {
      token,
      body: { ...window(60, 120), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.providerId).toBe(providerId);
    expect(created.body.data.status).toBe('OPEN');
    expect(created.body.data.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');

    // The slot exists, but the provider is not discoverable yet (no published
    // service, no verification): availability follows the discovery gate (T010)
    // instead of opening a second way to see a hidden provider.
    const listed = await request<ErrorBody>('GET', `/providers/${providerId}/availability`);
    expect(listed.status).toBe(404);
    expect(await slots.findById(created.body.data.id)).not.toBeNull();
  });

  it('validates the window server-side', async () => {
    const token = await login();
    await becomeProvider(token);

    const invalid: Record<string, unknown>[] = [
      { startAt: 'not-a-date', endAt: 'not-a-date' },
      { ...window(120, 60) },
      { ...window(60, 70) },
      { ...window(60, 60 + 24 * 60 + 1) },
      { startAt: '2020-01-01T00:00:00.000Z', endAt: '2020-01-01T01:00:00.000Z' },
      { ...window(60, 120), status: 'BOOKED' },
    ];

    for (const body of invalid) {
      const response = await request<ErrorBody>('POST', '/providers/me/availability', {
        token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses an overlapping slot', async () => {
    const token = await login();
    await becomeProvider(token);

    const first = await request<SlotBody>('POST', '/providers/me/availability', {
      token,
      body: window(600, 660),
    });
    expect(first.status).toBe(201);

    const overlap = await request<ErrorBody>('POST', '/providers/me/availability', {
      token,
      body: window(630, 690),
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error.code).toBe('VALIDATION_ERROR');

    // Touching windows are still free.
    await expect(
      request<SlotBody>('POST', '/providers/me/availability', { token, body: window(660, 720) }),
    ).resolves.toMatchObject({ status: 201 });
  });

  it('never lists a booked or past slot', async () => {
    const providerId = visible;
    const bookedWindow = window(1200, 1260);
    const booked = await slots.create({
      providerId,
      startAt: new Date(bookedWindow.startAt),
      endAt: new Date(bookedWindow.endAt),
      recurrenceRule: null,
    });
    const future = await slots.create({
      providerId,
      startAt: new Date(window(1500, 1560).startAt),
      endAt: new Date(window(1500, 1560).endAt),
      recurrenceRule: null,
    });
    await slots.create({
      providerId,
      startAt: new Date('2020-01-01T00:00:00.000Z'),
      endAt: new Date('2020-01-01T01:00:00.000Z'),
      recurrenceRule: null,
    });

    expect(
      await slots.claimByRange(
        providerId,
        new Date(bookedWindow.startAt),
        new Date(bookedWindow.endAt),
      ),
    ).not.toBeNull();

    const listed = await request<{ data: { items: { id: string }[]; total: number } }>(
      'GET',
      `/providers/${providerId}/availability`,
    );

    expect(listed.body.data.items.map((slot) => slot.id)).toEqual([future.id]);
    expect(listed.body.data.total).toBe(1);
    expect(booked.id).not.toBe(future.id);
  });

  it('hides the availability of a provider that is not discoverable', async () => {
    const response = await request<ErrorBody>('GET', `/providers/${hidden}/availability`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('deletes an own open slot, and keeps a booked one', async () => {
    const token = await login();
    const providerId = await becomeProvider(token);

    const created = await request<SlotBody>('POST', '/providers/me/availability', {
      token,
      body: window(2100, 2160),
    });

    const removed = await request<{ data: { id: string; deleted: boolean } }>(
      'DELETE',
      `/providers/me/availability/${created.body.data.id}`,
      { token },
    );
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id: created.body.data.id, deleted: true });

    // Gone: a second delete is not found.
    const again = await request<ErrorBody>(
      'DELETE',
      `/providers/me/availability/${created.body.data.id}`,
      { token },
    );
    expect(again.status).toBe(404);

    // Booked: a confirmed booking keeps its slot.
    const bookedWindow = window(2400, 2460);
    const booked = await request<SlotBody>('POST', '/providers/me/availability', {
      token,
      body: bookedWindow,
    });
    await slots.claimByRange(
      providerId,
      new Date(bookedWindow.startAt),
      new Date(bookedWindow.endAt),
    );

    const refused = await request<ErrorBody>(
      'DELETE',
      `/providers/me/availability/${booked.body.data.id}`,
      { token },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_ERROR');
    expect(await slots.findById(booked.body.data.id)).not.toBeNull();
  });

  it('refuses another provider slot and unknown ids', async () => {
    const owner = await login();
    await becomeProvider(owner);
    const created = await request<SlotBody>('POST', '/providers/me/availability', {
      token: owner,
      body: window(3000, 3060),
    });

    const other = await login();
    await becomeProvider(other);
    const foreign = await request<ErrorBody>(
      'DELETE',
      `/providers/me/availability/${created.body.data.id}`,
      { token: other },
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('FORBIDDEN');

    for (const id of [randomUUID(), 'not-a-uuid']) {
      const unknown = await request<ErrorBody>('DELETE', `/providers/me/availability/${id}`, {
        token: owner,
      });
      expect(unknown.status, id).toBe(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');
    }
  });
});
