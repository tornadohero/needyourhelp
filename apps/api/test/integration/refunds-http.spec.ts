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
import { PAYMENT_GATEWAY } from '../../src/modules/payments/domain/payment-gateway';
import { MockPaymentGateway } from '../../src/modules/payments/infrastructure/mock-payment.gateway';
import { RefundsModule } from '../../src/modules/refunds/refunds.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderStatus } from '../../src/modules/orders/domain/order.model';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T016 endpoints (`specs/05-api-spec.md` §Refund /
 * §Admin, `specs/08-payment-and-settlement.md` §Refund,
 * `specs/12-admin-spec.md`):
 *
 * - cannot refund more than what was captured;
 * - idempotent (both the customer request and the admin command);
 * - the customer route never moves money; the admin route is the audited one.
 */
describeWithDatabase('refund HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  const gateway = new MockPaymentGateway({ environment: 'test' });
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
        RefundsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'refunds-e2e-secret',
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
        openidPepper: 'refunds-e2e-pepper',
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
    await prisma.refund.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
    await prisma.payment.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
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

  interface RefundBody {
    data: {
      id: string;
      orderId: string;
      amountMinor: number;
      status: string;
      providerRef: string | null;
      reason: string | null;
    };
  }

  interface RequestBody {
    data: { orderId: string; orderStatus: string; refundableMinor: number };
  }

  interface ListBody {
    data: { items: { id: string; amountMinor: number; status: string }[]; total: number };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: T }> {
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
    return { status: response.status, body: (await response.json()) as T };
  }

  async function login(code: string): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t016-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function loginAsAdmin(): Promise<{ token: string; userId: string }> {
    const account = await login('admin');
    await prisma.userRole.create({ data: { userId: account.userId, role: 'ADMIN' } });
    // The role is read from the database on every request, so no re-login needed.
    return account;
  }

  /** A paid order with a captured payment, ready to refund. */
  async function newPaidOrder(options: { status?: OrderStatus; amountMinor?: number } = {}) {
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
        priceMinor: options.amountMinor ?? 20_000,
        currency: 'CNY',
        deliveryMode: 'ONLINE',
        status: 'PUBLISHED',
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNo: `MO-REFUND-${randomUUID().slice(0, 8)}`,
        buyerUserId: buyer.userId,
        providerId: provider.id,
        serviceId: service.id,
        domain: 'TUTORING',
        status: options.status ?? 'PAID',
        amountMinor: options.amountMinor ?? 20_000,
        platformFeeMinor: 2_000,
        providerAmountMinor: 18_000,
        currency: 'CNY',
        priceSnapshot: {
          serviceId: service.id,
          priceMinor: options.amountMinor ?? 20_000,
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

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'MOCK',
        providerTransactionId: `txn-${randomUUID()}`,
        status: 'SUCCEEDED',
        amountMinor: options.amountMinor ?? 20_000,
        paidAt: new Date(),
      },
    });

    return { buyer, owner, orderId: order.id };
  }

  it('requires a session, and the admin role for the command', async () => {
    const paid = await newPaidOrder();
    const customer = await login('customer');

    const anonymousRequest = await request<ErrorBody>(
      'POST',
      `/orders/${paid.orderId}/refund-request`,
      { body: {} },
    );
    expect(anonymousRequest.status).toBe(401);
    expect(anonymousRequest.body.error.code).toBe('AUTH_REQUIRED');

    const anonymousList = await request<ErrorBody>('GET', `/orders/${paid.orderId}/refunds`);
    expect(anonymousList.status).toBe(401);

    const anonymousRefund = await request<ErrorBody>(
      'POST',
      `/admin/orders/${paid.orderId}/refund`,
      { body: {} },
    );
    expect(anonymousRefund.status).toBe(401);

    // A logged-in non-admin may not move money.
    const forbidden = await request<ErrorBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: customer.token,
      body: {},
    });
    expect(forbidden.status).toBe(403);
  });

  it('lets the buyer request a refund without moving money', async () => {
    const paid = await newPaidOrder();

    const response = await request<RequestBody>('POST', `/orders/${paid.orderId}/refund-request`, {
      token: paid.buyer.token,
      body: { reason: '时间不合适' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      orderId: paid.orderId,
      orderStatus: 'REFUND_PENDING',
      refundableMinor: 20_000,
    });

    // No money moved: no refund row until an admin executes it.
    expect(await prisma.refund.count({ where: { orderId: paid.orderId } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } })).status).toBe(
      'REFUND_PENDING',
    );
  });

  it('refuses a request from a stranger and for an unpaid order', async () => {
    const paid = await newPaidOrder();
    const stranger = await login('stranger');

    const byStranger = await request<ErrorBody>('POST', `/orders/${paid.orderId}/refund-request`, {
      token: stranger.token,
      body: {},
    });
    expect(byStranger.status).toBe(404);
    expect(byStranger.body.error.code).toBe('NOT_FOUND');

    const unpaid = await newPaidOrder({ status: 'PENDING_PAYMENT' });
    await prisma.payment.deleteMany({ where: { orderId: unpaid.orderId } });

    const onUnpaid = await request<ErrorBody>('POST', `/orders/${unpaid.orderId}/refund-request`, {
      token: unpaid.buyer.token,
      body: {},
    });
    expect(onUnpaid.status).toBe(409);
    expect(onUnpaid.body.error.code).toBe('REFUND_NOT_ALLOWED');

    // Malformed id: never reaches the database.
    const malformed = await request<ErrorBody>('POST', '/orders/not-a-uuid/refund-request', {
      token: stranger.token,
      body: {},
    });
    expect(malformed.status).toBe(404);
  });

  it('refunds everything still refundable and closes the order', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();

    const response = await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { reason: '家长要求' },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      amountMinor: 20_000,
      status: 'SUCCEEDED',
      reason: '家长要求',
    });

    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } })).status).toBe(
      'REFUNDED',
    );

    // Every refund decision is audited (`specs/12-admin-spec.md`).
    const audit = await prisma.auditLog.findMany({ where: { resourceType: 'refund' } });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]).toMatchObject({ action: 'REFUND_INITIATED', actorType: 'ADMIN' });
  });

  it('cannot refund more than was captured', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();

    const tooMuch = await request<ErrorBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 20_001 },
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('REFUND_NOT_ALLOWED');

    await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 20_000 },
    });

    // Nothing is left: a second refund is refused, and no money moves twice.
    const second = await request<ErrorBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 1 },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REFUND_NOT_ALLOWED');
    expect(await prisma.refund.count({ where: { orderId: paid.orderId } })).toBe(1);
  });

  it('keeps the order in the refund branch for a partial refund', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();

    const partial = await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 5_000, reason: '部分退款' },
    });
    expect(partial.body.data.amountMinor).toBe(5_000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } })).status).toBe(
      'REFUND_PENDING',
    );

    // The remainder is still refundable.
    const remainder = await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 15_000 },
    });
    expect(remainder.body.data.amountMinor).toBe(15_000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } })).status).toBe(
      'REFUNDED',
    );
  });

  it('is idempotent for the request and for the command', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();

    const first = await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 5_000 },
      idempotencyKey: 'refund-key-1',
    });
    const replay = await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 5_000 },
      idempotencyKey: 'refund-key-1',
    });

    expect(replay.body.data.id).toBe(first.body.data.id);
    // One refund row: the replay moved no extra money.
    expect(await prisma.refund.count({ where: { orderId: paid.orderId } })).toBe(1);

    const conflict = await request<ErrorBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 6_000 },
      idempotencyKey: 'refund-key-1',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // The same key with the same payload on another order is refused too.
    const other = await newPaidOrder();
    const reused = await request<ErrorBody>('POST', `/admin/orders/${other.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 5_000 },
      idempotencyKey: 'refund-key-1',
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('lists the refunds of an order for both parties', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();
    const stranger = await login('stranger-list');

    await request<RefundBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
      token: admin.token,
      body: { amountMinor: 5_000 },
    });

    const byBuyer = await request<ListBody>('GET', `/orders/${paid.orderId}/refunds`, {
      token: paid.buyer.token,
    });
    expect(byBuyer.body.data.total).toBe(1);
    expect(byBuyer.body.data.items[0]).toMatchObject({ amountMinor: 5_000, status: 'SUCCEEDED' });

    const byOwner = await request<ListBody>('GET', `/orders/${paid.orderId}/refunds`, {
      token: paid.owner.token,
    });
    expect(byOwner.body.data.total).toBe(1);

    const byStranger = await request<ErrorBody>('GET', `/orders/${paid.orderId}/refunds`, {
      token: stranger.token,
    });
    expect(byStranger.status).toBe(404);
    expect(byStranger.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an invalid refund payload', async () => {
    const paid = await newPaidOrder();
    const admin = await loginAsAdmin();

    for (const body of [
      { amountMinor: 0 },
      { amountMinor: -1 },
      { amountMinor: 100.5 },
      { reason: 'x'.repeat(501) },
      { amountMinor: 5_000, extra: 1 },
    ]) {
      const response = await request<ErrorBody>('POST', `/admin/orders/${paid.orderId}/refund`, {
        token: admin.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    // And the customer route takes no amount at all.
    const withAmount = await request<ErrorBody>('POST', `/orders/${paid.orderId}/refund-request`, {
      token: paid.buyer.token,
      body: { amountMinor: 5_000 },
    });
    expect(withAmount.status).toBe(400);
  });
});
