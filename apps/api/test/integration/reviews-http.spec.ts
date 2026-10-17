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
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { ReviewsModule } from '../../src/modules/reviews/reviews.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T017 endpoints (`specs/05-api-spec.md` §Reviews,
 * `specs/01-business-rules.md` §Review):
 *
 * - a review is only possible after the order completed;
 * - one review per order and direction;
 * - the provider can review the customer only when policy enables it.
 */
describeWithDatabase('review HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  /** `specs/01` §Review: the provider direction is policy-gated. */
  let providerReviewCustomer = false;

  const userIds: string[] = [];
  const providerIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        ReviewsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'reviews-e2e-secret',
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
        openidPepper: 'reviews-e2e-pepper',
        defaultRoles: ['USER'],
      })
      .overrideProvider(FEATURE_FLAG_REPOSITORY)
      .useValue({
        isEnabled: async (flagKey: string) =>
          flagKey === 'provider_review_customer_enabled' && providerReviewCustomer,
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
    await prisma.review.deleteMany({ where: { order: { buyerUserId: { in: userIds } } } });
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

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface ReviewBody {
    data: {
      id: string;
      orderId: string;
      reviewerUserId: string;
      revieweeUserId: string;
      rating: number;
      content: string | null;
      status: string;
    };
  }

  interface ListBody {
    data: {
      items: { id: string; rating: number; content: string | null; status: string }[];
      total: number;
      page?: number;
      pageSize?: number;
    };
  }

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
      { body: { code: `t017-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  /**
   * A paid order, optionally driven to `COMPLETED` through the order commands,
   * which is what unlocks reviews and counts the delivered session.
   */
  async function newOrder(options: { complete?: boolean } = {}) {
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

    const created = await request<{ data: { id: string } }>('POST', '/orders', {
      token: buyer.token,
      body: {
        serviceId: service.id,
        scheduledStart: startAt.toISOString(),
        scheduledEnd: endAt.toISOString(),
      },
    });
    expect(created.status).toBe(201);
    const orderId = created.body.data.id;

    // `PAID` is written by the payment context (T014); the test sets it directly.
    await prisma.payment.create({
      data: {
        orderId,
        provider: 'MOCK',
        providerTransactionId: `txn-${randomUUID()}`,
        status: 'SUCCEEDED',
        amountMinor: 20_000,
        paidAt: new Date(),
      },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });

    if (options.complete) {
      for (const command of ['confirm', 'start', 'complete']) {
        const response = await request<{ data: { status: string } }>(
          'POST',
          `/orders/${orderId}/${command}`,
          { token: owner.token, body: {} },
        );
        expect(response.status, command).toBe(200);
      }
    }

    return { buyer, owner, orderId, providerId: provider.id };
  }

  it('requires a session for the order routes', async () => {
    const order = await newOrder({ complete: true });

    const anonymousCreate = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
      body: { rating: 5 },
    });
    expect(anonymousCreate.status).toBe(401);
    expect(anonymousCreate.body.error.code).toBe('AUTH_REQUIRED');

    const anonymousList = await request<ErrorBody>('GET', `/orders/${order.orderId}/reviews`);
    expect(anonymousList.status).toBe(401);
  });

  it('refuses a review before the order completed', async () => {
    const order = await newOrder();

    const response = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.buyer.token,
      body: { rating: 5, content: '提前评价' },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
    expect(await prisma.review.count({ where: { orderId: order.orderId } })).toBe(0);
  });

  it('lets the customer review a completed order once, and rolls the rating', async () => {
    const order = await newOrder({ complete: true });

    const created = await request<ReviewBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.buyer.token,
      body: { rating: 5, content: '讲得很清楚' },
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      orderId: order.orderId,
      reviewerUserId: order.buyer.userId,
      revieweeUserId: order.owner.userId,
      rating: 5,
      content: '讲得很清楚',
      status: 'PUBLISHED',
    });

    // Discovery ranks on both: the delivered session and the rating.
    const provider = await prisma.providerProfile.findUniqueOrThrow({
      where: { id: order.providerId },
    });
    expect(provider.completedOrderCount).toBe(1);
    expect(Number(provider.ratingAvg)).toBe(5);
    expect(provider.ratingCount).toBe(1);

    // One review per order and direction.
    const second = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.buyer.token,
      body: { rating: 1 },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
    expect(await prisma.review.count({ where: { orderId: order.orderId } })).toBe(1);
  });

  it('lets the provider review the customer only when policy enables it', async () => {
    const order = await newOrder({ complete: true });

    const disabled = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.owner.token,
      body: { rating: 4 },
    });
    expect(disabled.status).toBe(409);
    expect(disabled.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');

    providerReviewCustomer = true;
    const enabled = await request<ReviewBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.owner.token,
      body: { rating: 4, content: '学生很配合' },
    });
    providerReviewCustomer = false;

    expect(enabled.status).toBe(201);
    expect(enabled.body.data).toMatchObject({
      reviewerUserId: order.owner.userId,
      revieweeUserId: order.buyer.userId,
    });
  });

  it('keeps a stranger out and validates the payload', async () => {
    const order = await newOrder({ complete: true });
    const stranger = await login('stranger');

    const byStranger = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: stranger.token,
      body: { rating: 5 },
    });
    expect(byStranger.status).toBe(404);
    expect(byStranger.body.error.code).toBe('NOT_FOUND');

    for (const body of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: 5, content: 'x'.repeat(1001) },
      { rating: 5, extra: 1 },
    ]) {
      const response = await request<ErrorBody>('POST', `/orders/${order.orderId}/reviews`, {
        token: order.buyer.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    // A malformed id never reaches the database.
    const malformed = await request<ErrorBody>('POST', '/orders/not-a-uuid/reviews', {
      token: stranger.token,
      body: { rating: 5 },
    });
    expect(malformed.status).toBe(404);
  });

  it('lists the reviews of an order for both parties only', async () => {
    const order = await newOrder({ complete: true });
    const stranger = await login('stranger-list');

    await request<ReviewBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.buyer.token,
      body: { rating: 5 },
    });

    for (const token of [order.buyer.token, order.owner.token]) {
      const response = await request<ListBody>('GET', `/orders/${order.orderId}/reviews`, {
        token,
      });
      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.items[0]).toMatchObject({ rating: 5, status: 'PUBLISHED' });
    }

    const byStranger = await request<ErrorBody>('GET', `/orders/${order.orderId}/reviews`, {
      token: stranger.token,
    });
    expect(byStranger.status).toBe(404);
  });

  it('shows a public review page with published reviews only', async () => {
    const order = await newOrder({ complete: true });

    const created = await request<ReviewBody>('POST', `/orders/${order.orderId}/reviews`, {
      token: order.buyer.token,
      body: { rating: 5, content: '很好' },
    });

    const page = await request<ListBody>('GET', `/providers/${order.providerId}/reviews`);
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(page.body.data.items[0]).toMatchObject({ id: created.body.data.id, content: '很好' });

    // Moderation hides the text without deleting the row.
    await prisma.review.update({ where: { id: created.body.data.id }, data: { status: 'HIDDEN' } });
    const afterHiding = await request<ListBody>('GET', `/providers/${order.providerId}/reviews`);
    expect(afterHiding.body.data.total).toBe(0);

    // A provider who is not discoverable has no public review page.
    await prisma.providerProfile.update({
      where: { id: order.providerId },
      data: { searchable: false },
    });
    const hidden = await request<ErrorBody>('GET', `/providers/${order.providerId}/reviews`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('NOT_FOUND');

    // Unknown provider, and a page that is too large.
    const unknown = await request<ErrorBody>(
      'GET',
      '/providers/22222222-2222-4222-8222-222222222222/reviews',
    );
    expect(unknown.status).toBe(404);

    const tooLarge = await request<ErrorBody>(
      'GET',
      `/providers/${order.providerId}/reviews?pageSize=51`,
    );
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('VALIDATION_ERROR');
  });
});
