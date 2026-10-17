import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE, IDEMPOTENCY_HEADER } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG } from '../../src/modules/auth/domain/auth.service';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { OrdersModule } from '../../src/modules/orders/orders.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T013 endpoints (`specs/05-api-spec.md` §Orders,
 * `specs/01-business-rules.md` §Orders, `specs/14-test-strategy.md` §API tests):
 *
 * - the server derives the money: a client price is rejected, not honoured;
 * - status changes are commands with a state machine: no PATCH, no shortcuts;
 * - every gate (published service, discoverable provider, owned child,
 *   teacher compliance, availability) is enforced before an order exists;
 * - a buyer cancels, a provider confirms/starts/completes, nobody else.
 */
describeWithDatabase('order HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let providerId: string;
  let serviceId: string;
  let slotStart: Date;
  let slotEnd: Date;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        OrdersModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'orders-e2e-secret',
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
        openidPepper: 'orders-e2e-pepper',
        defaultRoles: ['USER'],
      })
      .compile();

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
    await prisma.order.deleteMany({ where: { buyerUserId: { in: userIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.service.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerCapability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface OrderBody {
    data: {
      id: string;
      orderNo: string;
      buyerUserId: string;
      providerId: string;
      serviceId: string;
      childId: string | null;
      status: string;
      amountMinor: number;
      platformFeeMinor: number;
      providerAmountMinor: number;
      currency: string;
      scheduledStart: string | null;
      scheduledEnd: string | null;
      priceSnapshot: { priceMinor: number; title: string };
    };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined || method === 'GET'
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.idempotencyKey ? { [IDEMPOTENCY_HEADER]: options.idempotencyKey } : {}),
      },
      ...(options.body === undefined || method === 'GET'
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  async function login(code: string): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t013-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  /** A discoverable provider with a published service and one open slot. */
  async function newProvider(options: { complianceStatus?: 'NOT_REQUIRED' | 'PENDING' } = {}) {
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

    await prisma.providerCapability.create({
      data: {
        providerId: provider.id,
        capabilityType: 'STUDENT_TUTOR',
        status: 'APPROVED',
        verificationLevel: 'FULL',
        complianceStatus: options.complianceStatus ?? 'NOT_REQUIRED',
      },
    });

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

    slotStart = new Date(Date.now() + 120 * 60_000);
    slotEnd = new Date(Date.now() + 180 * 60_000);
    await prisma.availabilitySlot.create({
      data: {
        providerId: provider.id,
        startAt: slotStart,
        endAt: slotEnd,
        status: 'OPEN',
      },
    });

    return { owner, providerId: provider.id, serviceId: service.id };
  }

  function window() {
    return { scheduledStart: slotStart.toISOString(), scheduledEnd: slotEnd.toISOString() };
  }

  it('requires a session for every order route', async () => {
    const paths: ['GET' | 'POST', string][] = [
      ['GET', '/orders'],
      ['POST', '/orders'],
      ['GET', `/orders/${randomUUID()}`],
      ['POST', `/orders/${randomUUID()}/cancel`],
      ['POST', `/orders/${randomUUID()}/confirm`],
      ['POST', `/orders/${randomUUID()}/start`],
      ['POST', `/orders/${randomUUID()}/complete`],
    ];

    for (const [method, path] of paths) {
      const response = await request<ErrorBody>(method, path, { body: {} });
      expect(response.status, path).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    }
  });

  it('creates an order for the price the server calculates', async () => {
    const buyer = await login('buyer');
    const provider = await newProvider();
    serviceId = provider.serviceId;
    providerId = provider.providerId;

    const created = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: provider.serviceId, ...window() },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING_PAYMENT');
    expect(created.body.data.amountMinor).toBe(20_000);
    expect(created.body.data.platformFeeMinor).toBe(2_000);
    expect(created.body.data.providerAmountMinor).toBe(18_000);
    expect(created.body.data.currency).toBe('CNY');
    expect(created.body.data.priceSnapshot.priceMinor).toBe(20_000);
    expect(created.body.data.scheduledStart).toBe(slotStart.toISOString());

    // The slot is taken: a second order for the same time has no availability.
    const second = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: provider.serviceId, ...window() },
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('VALIDATION_ERROR');

    expect(
      (await prisma.availabilitySlot.findFirst({ where: { providerId: provider.providerId } }))
        ?.status,
    ).toBe('BOOKED');
  });

  it('rejects any client-supplied money or status', async () => {
    const buyer = await login('buyer2');
    const provider = await newProvider();

    for (const body of [
      { serviceId: provider.serviceId, ...window(), amountMinor: 1 },
      { serviceId: provider.serviceId, ...window(), priceMinor: 1 },
      { serviceId: provider.serviceId, ...window(), platformFeeMinor: 0 },
      { serviceId: provider.serviceId, ...window(), status: 'PAID' },
      { serviceId: provider.serviceId, ...window(), providerId: provider.providerId },
    ]) {
      const response = await request<ErrorBody>('POST', '/orders', {
        token: buyer.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses an order that breaks a gate', async () => {
    const buyer = await login('buyer3');
    const provider = await newProvider();

    // Past window, impossible window, unknown service and unknown child.
    for (const body of [
      {
        serviceId: provider.serviceId,
        scheduledStart: '2020-01-01T00:00:00.000Z',
        scheduledEnd: '2020-01-01T01:00:00.000Z',
      },
      {
        serviceId: provider.serviceId,
        scheduledStart: window().scheduledEnd,
        scheduledEnd: window().scheduledStart,
      },
      { serviceId: 'not-a-uuid', ...window() },
      { serviceId: provider.serviceId, ...window(), childId: randomUUID() },
    ]) {
      const response = await request<ErrorBody>('POST', '/orders', {
        token: buyer.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    // A service that does not exist is not found, not invalid.
    const unknownService = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: randomUUID(), ...window() },
    });
    expect(unknownService.status).toBe(404);
    expect(unknownService.body.error.code).toBe('NOT_FOUND');

    // A provider the platform does not show cannot be ordered.
    const hidden = await newProvider();
    await prisma.providerProfile.update({
      where: { id: hidden.providerId },
      data: { searchable: false },
    });
    const hiddenOrder = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: hidden.serviceId, ...window() },
    });
    expect(hiddenOrder.status).toBe(404);
    expect(hiddenOrder.body.error.code).toBe('NOT_FOUND');

    // A teacher capability that compliance has not cleared blocks the order.
    const pendingTeacher = await newProvider({ complianceStatus: 'PENDING' });
    await prisma.providerCapability.deleteMany({
      where: { providerId: pendingTeacher.providerId },
    });
    await prisma.providerCapability.create({
      data: {
        providerId: pendingTeacher.providerId,
        capabilityType: 'TEACHER',
        status: 'APPROVED',
        verificationLevel: 'FULL',
        complianceStatus: 'PENDING',
      },
    });
    const blocked = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: pendingTeacher.serviceId, ...window() },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FORBIDDEN');
  });

  it('replays an idempotent create and refuses a reused key', async () => {
    const buyer = await login('buyer4');
    const provider = await newProvider();
    const body = { serviceId: provider.serviceId, ...window() };

    const first = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body,
      idempotencyKey: 'order-key-1',
    });
    expect(first.status).toBe(201);

    const replay = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body,
      idempotencyKey: 'order-key-1',
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(first.body.data.id);

    const conflict = await request<ErrorBody>('POST', '/orders', {
      token: buyer.token,
      body: { ...body, note: '换个时间' },
      idempotencyKey: 'order-key-1',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('lists and reads orders for the parties only', async () => {
    const buyer = await login('buyer5');
    const provider = await newProvider();
    const stranger = await login('stranger5');

    const created = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: provider.serviceId, ...window() },
    });

    expect(
      (await request<{ data: { total: number } }>('GET', '/orders', { token: buyer.token })).body
        .data.total,
    ).toBe(1);
    expect(
      (
        await request<{ data: { total: number } }>('GET', '/orders', {
          token: provider.owner.token,
        })
      ).body.data.total,
    ).toBe(1);
    expect(
      (await request<{ data: { total: number } }>('GET', '/orders', { token: stranger.token })).body
        .data.total,
    ).toBe(0);

    expect(
      (await request<OrderBody>('GET', `/orders/${created.body.data.id}`, { token: buyer.token }))
        .status,
    ).toBe(200);

    for (const id of [created.body.data.id, randomUUID(), 'not-a-uuid']) {
      const response = await request<ErrorBody>('GET', `/orders/${id}`, { token: stranger.token });
      expect(response.status, id).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('moves the status through commands only', async () => {
    const buyer = await login('buyer6');
    const provider = await newProvider();

    const created = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: provider.serviceId, ...window(), childId: null },
    });
    const orderId = created.body.data.id;

    // Unpaid: the provider cannot confirm it.
    const tooEarly = await request<ErrorBody>('POST', `/orders/${orderId}/confirm`, {
      token: provider.owner.token,
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('ORDER_INVALID_STATE');

    // `PAID` is the payment context's (T014); tests set the state directly.
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });

    // The buyer may not move it forward.
    const wrongRole = await request<ErrorBody>('POST', `/orders/${orderId}/confirm`, {
      token: buyer.token,
    });
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.error.code).toBe('FORBIDDEN');

    const confirmed = await request<OrderBody>('POST', `/orders/${orderId}/confirm`, {
      token: provider.owner.token,
    });
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    // Completing before the session started is not a transition.
    const skip = await request<ErrorBody>('POST', `/orders/${orderId}/complete`, {
      token: provider.owner.token,
    });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('ORDER_INVALID_STATE');

    const started = await request<OrderBody>('POST', `/orders/${orderId}/start`, {
      token: provider.owner.token,
    });
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const completed = await request<OrderBody>('POST', `/orders/${orderId}/complete`, {
      token: provider.owner.token,
    });
    expect(completed.body.data.status).toBe('COMPLETED');

    // Terminal: nothing moves a completed order.
    const again = await request<ErrorBody>('POST', `/orders/${orderId}/complete`, {
      token: provider.owner.token,
    });
    expect(again.status).toBe(409);
  });

  it('cancels an unpaid order for the buyer and frees the slot', async () => {
    const buyer = await login('buyer7');
    const provider = await newProvider();

    const created = await request<OrderBody>('POST', '/orders', {
      token: buyer.token,
      body: { serviceId: provider.serviceId, ...window() },
    });

    const cancelled = await request<OrderBody>('POST', `/orders/${created.body.data.id}/cancel`, {
      token: buyer.token,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    // The time is bookable again.
    expect(
      (await prisma.availabilitySlot.findFirst({ where: { providerId: provider.providerId } }))
        ?.status,
    ).toBe('OPEN');
    expect(serviceId).toBeDefined();
    expect(providerId).toBeDefined();
  });
});
