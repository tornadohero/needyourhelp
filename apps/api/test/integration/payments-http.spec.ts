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
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PAYMENT_GATEWAY } from '../../src/modules/payments/domain/payment-gateway';
import { MockPaymentGateway } from '../../src/modules/payments/infrastructure/mock-payment.gateway';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T014 endpoints (`specs/05-api-spec.md` §Payments,
 * `specs/08-payment-and-settlement.md`, `specs/14-test-strategy.md` §E2E-04,
 * `specs/13-security-spec.md` §Security acceptance):
 *
 * - idempotency: a retried session request reuses the payment;
 * - callback replay safe: the second notification changes nothing (E2E-04);
 * - amount mismatch rejected: a tampered amount never pays the order;
 * - the client saying "success" is not what marks an order paid.
 */
describeWithDatabase('payment HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  const gateway = new MockPaymentGateway({ environment: 'test' });
  let app: INestApplication;
  let baseUrl: string;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  let slotStart: Date;
  let slotEnd: Date;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        OrdersModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'payments-e2e-secret',
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
        openidPepper: 'payments-e2e-pepper',
        defaultRoles: ['USER'],
      })
      .compile();

    // `rawBody` keeps the exact bytes a provider signed, as production does.
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
    await prisma.providerCapability.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface SessionBody {
    data: {
      paymentId: string;
      orderId: string;
      orderNo: string;
      providerTransactionId: string | null;
      amountMinor: number;
      status: string;
      reused: boolean;
      params: Record<string, unknown>;
    };
  }

  interface NotifyBody {
    data: { orderNo: string; orderStatus: string; paymentStatus: string; applied: boolean };
  }

  interface StatusBody {
    data: {
      orderId: string;
      orderStatus: string;
      amountMinor: number;
      payment: { id: string; status: string; paidAt: string | null } | null;
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
      { body: { code: `t014-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  /** A discoverable provider with a published service and one open slot. */
  async function newProvider() {
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
        complianceStatus: 'NOT_REQUIRED',
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
      data: { providerId: provider.id, startAt: slotStart, endAt: slotEnd, status: 'OPEN' },
    });

    return { owner, providerId: provider.id, serviceId: service.id };
  }

  async function newOrder() {
    const buyer = await login(`buyer-${randomUUID()}`);
    const provider = await newProvider();
    const created = await request<{ data: { id: string; orderNo: string } }>('POST', '/orders', {
      token: buyer.token,
      body: {
        serviceId: provider.serviceId,
        scheduledStart: slotStart.toISOString(),
        scheduledEnd: slotEnd.toISOString(),
      },
    });
    expect(created.status).toBe(201);

    return {
      buyer,
      provider,
      orderId: created.body.data.id,
      orderNo: created.body.data.orderNo,
    };
  }

  const notifyPayload = (orderNo: string, transactionId: string, amountMinor: number) => ({
    orderNo,
    providerTransactionId: transactionId,
    amountMinor,
    status: 'SUCCEEDED',
  });

  it('requires a session for the payment routes, but not for the callback', async () => {
    const order = await newOrder();

    const session = await request<ErrorBody>('POST', `/orders/${order.orderId}/payment-session`);
    expect(session.status).toBe(401);
    expect(session.body.error.code).toBe('AUTH_REQUIRED');

    const status = await request<ErrorBody>('GET', `/orders/${order.orderId}/payment-status`);
    expect(status.status).toBe(401);

    // The notification is server-to-server: it answers without a token.
    const notify = await request<ErrorBody>('POST', '/payments/wechat/notify', {
      body: { orderNo: order.orderNo, providerTransactionId: 'txn-none' },
    });
    expect(notify.status).toBe(400);
    expect(notify.body.error.code).toBe('PAYMENT_CALLBACK_INVALID');
  });

  it('opens a payment session for the order amount', async () => {
    const order = await newOrder();

    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    expect(session.status).toBe(201);
    expect(session.body.data.amountMinor).toBe(20_000);
    expect(session.body.data.status).toBe('INITIATED');
    expect(session.body.data.reused).toBe(false);
    expect(session.body.data.providerTransactionId).toBeTruthy();
    // No secret is ever returned or stored in the response.
    expect(session.raw).not.toContain('apiKey');

    // A second call reuses the open session: one provider transaction.
    const again = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });
    expect(again.body.data.reused).toBe(true);
    expect(again.body.data.paymentId).toBe(session.body.data.paymentId);

    // The provider may not pay, and a stranger cannot even see the order.
    const byProvider = await request<ErrorBody>(
      'POST',
      `/orders/${order.orderId}/payment-session`,
      { token: order.provider.owner.token },
    );
    expect(byProvider.status).toBe(403);
    expect(byProvider.body.error.code).toBe('FORBIDDEN');
  });

  it('replays an idempotent session request and refuses a reused key', async () => {
    const order = await newOrder();

    const first = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
      idempotencyKey: 'pay-key-1',
    });
    const replay = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
      idempotencyKey: 'pay-key-1',
    });
    expect(replay.body.data.paymentId).toBe(first.body.data.paymentId);

    const other = await newOrder();
    const conflict = await request<ErrorBody>('POST', `/orders/${other.orderId}/payment-session`, {
      token: other.buyer.token,
      idempotencyKey: 'pay-key-1',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refuses to pay an order that is not pending payment', async () => {
    const order = await newOrder();
    await prisma.order.update({ where: { id: order.orderId }, data: { status: 'CANCELLED' } });

    const session = await request<ErrorBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });
    expect(session.status).toBe(409);
    expect(session.body.error.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('pays the order when the server confirms the callback', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    const notify = await request<NotifyBody>('POST', '/payments/wechat/notify', {
      body: notifyPayload(order.orderNo, session.body.data.providerTransactionId!, 20_000),
    });

    expect(notify.status).toBe(200);
    expect(notify.body.data).toMatchObject({
      applied: true,
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(stored.status).toBe('PAID');

    const status = await request<StatusBody>('GET', `/orders/${order.orderId}/payment-status`, {
      token: order.buyer.token,
    });
    expect(status.body.data.orderStatus).toBe('PAID');
    expect(status.body.data.payment?.status).toBe('SUCCEEDED');
    expect(status.body.data.amountMinor).toBe(20_000);
  });

  it('answers a replayed callback without a second transition', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });
    const payload = notifyPayload(order.orderNo, session.body.data.providerTransactionId!, 20_000);

    const first = await request<NotifyBody>('POST', '/payments/wechat/notify', { body: payload });
    const replay = await request<NotifyBody>('POST', '/payments/wechat/notify', { body: payload });

    expect(first.body.data.applied).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.body.data.applied).toBe(false);
    expect(replay.body.data.orderStatus).toBe('PAID');

    // One payment, one paid order: the replay changed nothing.
    expect(await prisma.payment.count({ where: { orderId: order.orderId } })).toBe(1);
  });

  it('rejects a callback whose amount does not match the order', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    for (const amount of [1, 19_999, 20_001]) {
      const notify = await request<ErrorBody>('POST', '/payments/wechat/notify', {
        body: notifyPayload(order.orderNo, session.body.data.providerTransactionId!, amount),
      });
      expect(notify.status, String(amount)).toBe(400);
      expect(notify.body.error.code).toBe('PAYMENT_CALLBACK_INVALID');
    }

    // Never paid, and the attempt is not marked succeeded.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } });
    expect(payment.status).toBe('INITIATED');
    expect(payment.paidAt).toBeNull();
  });

  it('rejects a malformed or unknown callback', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    const bodies: Record<string, unknown>[] = [
      {},
      { orderNo: order.orderNo },
      { orderNo: order.orderNo, providerTransactionId: session.body.data.providerTransactionId },
      {
        orderNo: 'MO-NOPE-00000000',
        providerTransactionId: session.body.data.providerTransactionId,
        amountMinor: 20_000,
        status: 'SUCCEEDED',
      },
      {
        orderNo: order.orderNo,
        providerTransactionId: 'txn-unknown',
        amountMinor: 20_000,
        status: 'SUCCEEDED',
      },
      {
        orderNo: order.orderNo,
        providerTransactionId: session.body.data.providerTransactionId,
        amountMinor: 20_000,
        status: 'PAID',
      },
    ];

    for (const body of bodies) {
      const response = await request<ErrorBody>('POST', '/payments/wechat/notify', { body });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('PAYMENT_CALLBACK_INVALID');
    }

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });

  it('ignores provider-specific fields in a callback', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    // A notification is not a whitelisted DTO: the provider may send more.
    const notify = await request<NotifyBody>('POST', '/payments/wechat/notify', {
      body: {
        ...notifyPayload(order.orderNo, session.body.data.providerTransactionId!, 20_000),
        extra: 1,
      },
    });

    expect(notify.status).toBe(200);
    expect(notify.body.data.orderStatus).toBe('PAID');
  });

  it('records a provider failure without paying the order', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    const notify = await request<ErrorBody>('POST', '/payments/wechat/notify', {
      body: {
        orderNo: order.orderNo,
        providerTransactionId: session.body.data.providerTransactionId,
        amountMinor: 20_000,
        status: 'FAILED',
      },
    });

    expect(notify.status).toBe(402);
    expect(notify.body.error.code).toBe('PAYMENT_FAILED');
    expect(
      (await prisma.payment.findFirstOrThrow({ where: { orderId: order.orderId } })).status,
    ).toBe('FAILED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });

  it('confirms a lost notification through the provider query', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });

    // Still open: the provider has not captured anything yet.
    const pending = await request<StatusBody>('GET', `/orders/${order.orderId}/payment-status`, {
      token: order.buyer.token,
    });
    expect(pending.body.data.payment?.status).toBe('INITIATED');
    expect(pending.body.data.orderStatus).toBe('PENDING_PAYMENT');

    // The provider captured the money but the notification never arrived.
    gateway.markPaid(session.body.data.providerTransactionId!, 20_000);

    const confirmed = await request<StatusBody>('GET', `/orders/${order.orderId}/payment-status`, {
      token: order.buyer.token,
    });
    expect(confirmed.body.data.orderStatus).toBe('PAID');
    expect(confirmed.body.data.payment?.status).toBe('SUCCEEDED');
  });

  it('rejects a provider query that reports another amount', async () => {
    const order = await newOrder();
    const session = await request<SessionBody>('POST', `/orders/${order.orderId}/payment-session`, {
      token: order.buyer.token,
    });
    gateway.markPaid(session.body.data.providerTransactionId!, 1);

    const response = await request<ErrorBody>('GET', `/orders/${order.orderId}/payment-status`, {
      token: order.buyer.token,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PAYMENT_CALLBACK_INVALID');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });
});
