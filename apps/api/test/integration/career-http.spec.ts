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
import { AvailabilityModule } from '../../src/modules/availability/availability.module';
import { DiscoveryModule } from '../../src/modules/discovery/discovery.module';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PlatformModule } from '../../src/modules/platform/platform.module';
import { ProviderModule } from '../../src/modules/provider/provider.module';
import { ReviewsModule } from '../../src/modules/reviews/reviews.module';
import { ServicesModule } from '../../src/modules/services/services.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Career marketplace (T021; `specs/00-product-spec.md` §Career Mentor,
 * `specs/03-architecture-spec.md` §Feature flags).
 *
 * Acceptance:
 * - with the flag off there is no career route at all — not only a hidden
 *   listing: applying, submitting, publishing, offering time, ordering and
 *   reading reviews are all refused;
 * - with the flag on, a mentor reuses the existing provider, service,
 *   availability, order, payment and review infrastructure unchanged.
 */
describeWithDatabase('career marketplace HTTP endpoints', () => {
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
        ProviderModule,
        ServicesModule,
        AvailabilityModule,
        OrdersModule,
        PaymentsModule,
        ReviewsModule,
        DiscoveryModule,
        PlatformModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'career-e2e-secret',
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
        openidPepper: 'career-e2e-pepper',
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

    // A career expertise tag: `SKILL` is the taxonomy type for it.
    await prisma.taxonomyTerm.create({
      data: { type: 'SKILL', code: 'RESUME_REVIEW', name: '简历诊断', active: true },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.review.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
    await prisma.payment.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
    await prisma.order.deleteMany({ where: { buyerUserId: { in: userIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.taxonomyTerm.deleteMany({ where: { code: 'RESUME_REVIEW' } });
    await prisma.featureFlag.deleteMany({ where: { key: 'career_marketplace_enabled' } });
    await prisma.auditLog.deleteMany({ where: { resourceType: 'feature_flag' } });
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
      { body: { code: `t021-${code}-${randomUUID()}` } },
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

  /** The flag is a real row: the platform reads it, nothing is stubbed. */
  async function setCareerFlag(enabled: boolean): Promise<void> {
    await prisma.featureFlag.upsert({
      where: { key: 'career_marketplace_enabled' },
      create: { key: 'career_marketplace_enabled', enabled },
      update: { enabled },
    });
  }

  /** A live career mentor, built while the marketplace is open. */
  async function seedCareerProvider(code: string): Promise<{
    mentor: { token: string; userId: string };
    providerId: string;
    serviceId: string;
    startAt: string;
    endAt: string;
  }> {
    await setCareerFlag(true);
    const mentor = await login(code);
    const admin = await loginAsAdmin(`${code}-admin`);

    const application = await request<{ data: { id: string } }>('POST', '/providers/applications', {
      token: mentor.token,
      body: {
        providerType: 'CAREER',
        publicName: '职业导师',
        capabilityTypes: ['CAREER_MENTOR'],
      },
    });
    expect(application.status).toBe(201);
    const providerId = application.body.data.id;
    providerIds.push(providerId);

    await request('POST', '/providers/me/submit?providerType=CAREER', {
      token: mentor.token,
      body: {},
    });
    await request('POST', `/admin/providers/${providerId}/approve`, {
      token: admin.token,
      body: { reason: '材料齐全' },
    });
    await prisma.verificationCase.createMany({
      data: [
        {
          providerId,
          verificationType: 'IDENTITY',
          status: 'APPROVED',
          reviewedAt: new Date(),
        },
        { providerId, verificationType: 'EDUCATION', status: 'APPROVED', reviewedAt: new Date() },
      ],
    });

    const service = await request<{ data: { id: string } }>(
      'POST',
      '/providers/me/services?providerType=CAREER',
      {
        token: mentor.token,
        body: {
          title: '简历诊断',
          durationMinutes: 45,
          priceMinor: 30_000,
          skillCodes: ['RESUME_REVIEW'],
        },
      },
    );
    expect(service.status).toBe(201);
    const serviceId = service.body.data.id;

    await request('POST', `/providers/me/services/${serviceId}/publish?providerType=CAREER`, {
      token: mentor.token,
      body: {},
    });

    const startAt = new Date(Date.now() + 24 * 60 * 60_000);
    const endAt = new Date(startAt.getTime() + 45 * 60_000);
    const slot = await request('POST', '/providers/me/availability?providerType=CAREER', {
      token: mentor.token,
      body: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    });
    expect(slot.status).toBe(201);

    return {
      mentor,
      providerId,
      serviceId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    };
  }

  it('hides the whole career marketplace while the flag is off', async () => {
    await setCareerFlag(false);
    const mentor = await login('mentor-off');

    // No career application, so no career provider can exist at all.
    const application = await request<ErrorBody>('POST', '/providers/applications', {
      token: mentor.token,
      body: {
        providerType: 'CAREER',
        publicName: '职业导师',
        capabilityTypes: ['CAREER_MENTOR'],
      },
    });
    expect(application.status).toBe(403);
    expect(application.body.error.code).toBe('FORBIDDEN');

    const list = await request<{ data: { items: unknown[]; total: number } }>(
      'GET',
      '/providers?domain=CAREER',
    );
    expect(list.body.data.total).toBe(0);
  });

  it('closes a mentor that already exists, and blocks ordering by id', async () => {
    const { providerId, serviceId } = await seedCareerProvider('legacy');

    // The marketplace is switched off after the mentor went live.
    await setCareerFlag(false);

    const detail = await request<ErrorBody>('GET', `/providers/${providerId}`);
    expect(detail.status).toBe(404);

    // The important one: knowing the service id must not be enough to order.
    const buyer = await login('buyer-off');
    const order = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: {
        serviceId,
        scheduledStart: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 24 * 60 * 60_000 + 45 * 60_000).toISOString(),
      },
    });
    expect(order.status).toBe(404);

    const reviews = await request<ErrorBody>('GET', `/providers/${providerId}/reviews`);
    expect(reviews.status).toBe(404);

    const list = await request<{ data: { total: number } }>('GET', '/providers?domain=CAREER');
    expect(list.body.data.total).toBe(0);
  });

  it('closes the mentor’s own routes while the flag is off', async () => {
    const { mentor } = await seedCareerProvider('closed-mentor');
    await setCareerFlag(false);

    const submit = await request<ErrorBody>('POST', '/providers/me/submit?providerType=CAREER', {
      token: mentor.token,
      body: {},
    });
    expect(submit.status).toBe(403);

    const service = await request<ErrorBody>('POST', '/providers/me/services?providerType=CAREER', {
      token: mentor.token,
      body: {
        title: '面试辅导',
        durationMinutes: 30,
        priceMinor: 20_000,
        skillCodes: ['RESUME_REVIEW'],
      },
    });
    expect(service.status).toBe(403);

    const startAt = new Date(Date.now() + 48 * 60 * 60_000);
    const slot = await request<ErrorBody>(
      'POST',
      '/providers/me/availability?providerType=CAREER',
      {
        token: mentor.token,
        body: {
          startAt: startAt.toISOString(),
          endAt: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
        },
      },
    );
    expect(slot.status).toBe(403);
  });

  it('runs the whole career journey on the existing infrastructure when on', async () => {
    const { mentor, providerId, serviceId, startAt, endAt } = await seedCareerProvider('journey');
    await setCareerFlag(true);
    const admin = await loginAsAdmin('journey-admin');
    const buyer = await login('journey-buyer');

    // The mentor is discoverable in the career marketplace only.
    const careerList = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?domain=CAREER',
    );
    expect(careerList.body.data.items.map((hit) => hit.id)).toContain(providerId);

    const tutoringList = await request<{ data: { items: { id: string }[] } }>(
      'GET',
      '/providers?domain=TUTORING',
    );
    expect(tutoringList.body.data.items.map((hit) => hit.id)).not.toContain(providerId);

    // Booking, payment, completion and review: all unchanged code paths.
    const orderResponse = await request<{ data: { id: string; orderNo: string; domain: string } }>(
      'POST',
      '/orders',
      {
        token: buyer.token,
        body: {
          serviceId,
          scheduledStart: startAt,
          scheduledEnd: endAt,
        },
      },
    );
    if (orderResponse.status !== 201) {
      // Surface the real answer instead of a bare status mismatch.
      throw new Error(JSON.stringify(orderResponse.body));
    }
    const order = orderResponse;
    expect(order.body.data.domain).toBe('CAREER');

    const session = await request<{ data: { providerTransactionId: string } }>(
      'POST',
      `/orders/${order.body.data.id}/payment-session`,
      { token: buyer.token, body: {} },
    );
    expect(session.status).toBe(201);

    await request('POST', '/payments/wechat/notify', {
      body: {
        orderNo: order.body.data.orderNo,
        providerTransactionId: session.body.data.providerTransactionId,
        amountMinor: 30_000,
        status: 'SUCCEEDED',
      },
    });

    for (const command of ['confirm', 'start', 'complete']) {
      const response = await request<{ data: { status: string } }>(
        'POST',
        `/orders/${order.body.data.id}/${command}?providerType=CAREER`,
        { token: mentor.token, body: {} },
      );
      expect(response.status, command).toBe(200);
    }

    const review = await request<{ data: { rating: number } }>(
      'POST',
      `/orders/${order.body.data.id}/reviews`,
      { token: buyer.token, body: { rating: 5, content: '很有帮助' } },
    );
    expect(review.status).toBe(201);

    const publicReviews = await request<{ data: { total: number } }>(
      'GET',
      `/providers/${providerId}/reviews`,
    );
    expect(publicReviews.body.data.total).toBe(1);

    // The admin flag change is audited like any production change.
    await request('PATCH', '/admin/feature-flags/career_marketplace_enabled', {
      token: admin.token,
      body: { enabled: true },
    });
    const audit = await prisma.auditLog.findMany({
      where: { resourceType: 'feature_flag', resourceId: 'career_marketplace_enabled' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'FEATURE_FLAG_CHANGED', actorType: 'ADMIN' });
  });
});
