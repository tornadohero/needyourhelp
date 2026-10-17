import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { ANALYTICS_SINK } from '../../src/modules/analytics/domain/analytics-sink';
import type { AnalyticsSink } from '../../src/modules/analytics/domain/analytics-sink';
import type { AnalyticsEvent } from '../../src/modules/analytics/domain/analytics-event.model';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG } from '../../src/modules/auth/domain/auth.service';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { DiscoveryModule } from '../../src/modules/discovery/discovery.module';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Analytics in the request path (`specs/15-analytics-spec.md`).
 *
 * The sink is replaced by a spy, so the test asserts on the events themselves:
 * the funnel fires at the right moments, and no event carries a child — the
 * acceptance criterion of T020.
 */
describeWithDatabase('analytics events', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const events: AnalyticsEvent[] = [];

  const userIds: string[] = [];
  const providerIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        DiscoveryModule,
        OrdersModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ANALYTICS_SINK)
      .useValue({
        record: async (event: AnalyticsEvent) => {
          events.push(event);
        },
      } as AnalyticsSink)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'analytics-e2e-secret',
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
        openidPepper: 'analytics-e2e-pepper',
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
    await prisma.payment.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
    await prisma.order.deleteMany({ where: { buyerUserId: { in: userIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

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
      { body: { code: `t020-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  it('tracks the funnel without ever carrying a child', async () => {
    const buyer = await login('buyer');
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

    const startAt = new Date(Date.now() + 24 * 60 * 60_000);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);
    await prisma.availabilitySlot.create({
      data: { providerId: provider.id, startAt, endAt, status: 'OPEN' },
    });

    // 1. Discovery.
    await request('GET', '/providers', {});
    await request('GET', `/providers/${provider.id}`, {});

    // 2. Booking: the order is created for the price the server calculated.
    const order = await request<{ data: { id: string; orderNo: string } }>('POST', '/orders', {
      token: buyer.token,
      body: {
        serviceId: service.id,
        scheduledStart: startAt.toISOString(),
        scheduledEnd: endAt.toISOString(),
      },
    });
    expect(order.status).toBe(201);

    // 3. Payment.
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
        amountMinor: 20_000,
        status: 'SUCCEEDED',
      },
    });

    const names = events.map((event) => event.name);
    expect(names).toContain('provider_list_viewed');
    expect(names).toContain('provider_detail_viewed');
    expect(names).toContain('order_created');
    expect(names).toContain('order_received');
    expect(names).toContain('payment_started');
    expect(names).toContain('payment_succeeded');

    // The acting account is counted, never named.
    for (const event of events) {
      if (event.actorIdHash !== null) {
        expect(event.actorIdHash).not.toBe(buyer.userId);
        expect(event.actorIdHash).toHaveLength(64);
      }
    }

    // The acceptance criterion: no child and no personal data as a dimension.
    for (const event of events) {
      for (const key of Object.keys(event.props)) {
        expect(key, `${event.name}.${key}`).not.toMatch(
          /child_id|student|pupil|guardian|phone|mobile|email|address|name|birth|school|grade|document|identity|wechat|openid|avatar|content|message|note|reason|description/,
        );
      }
      // And no raw account id ever leaves the process: actors are hashed.
      expect(JSON.stringify(event.props)).not.toContain(buyer.userId);
      expect(JSON.stringify(event.props)).not.toContain(owner.userId);
    }

    // What is left is a metric: the money and whether a child was involved.
    const created = events.find((event) => event.name === 'order_created');
    expect(created?.props).toMatchObject({ amount_minor: 20_000, has_child: false });
    expect(Object.keys(created?.props ?? {})).toEqual(['amount_minor', 'has_child']);
  });
});
