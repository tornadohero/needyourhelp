import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AppModule } from '../../../src/app.module';
import { AllExceptionsFilter } from '../../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../../src/common/interceptors/response-envelope.interceptor';
import { RateLimitInterceptor } from '../../../src/common/security/rate-limit.interceptor';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service';
import {
  createTestPrismaService,
  describeWithDatabase,
} from '../../integration/helpers/test-database';

export { describeWithDatabase };

/**
 * The end-to-end harness (`specs/14-test-strategy.md` §E2E).
 *
 * An E2E test drives the **whole** application: the real `AppModule`, the real
 * module graph, the real guards, interceptors and filters — the same wiring
 * `main.ts` boots in production. Only the database is swapped for the disposable
 * one, so a journey can never pass because a test wired a service differently.
 */
export interface E2EHarness {
  app: INestApplication;
  prisma: PrismaService;
  baseUrl: string;
}

export async function createHarness(): Promise<E2EHarness> {
  const prisma = createTestPrismaService();
  await prisma.$connect();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
  app.useGlobalFilters(new AllExceptionsFilter());
  // Same pipe as production: unknown fields are refused, not silently dropped.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(),
    // Resolved from the container: the limiter needs the policy repository.
    app.get(RateLimitInterceptor, { strict: false }),
  );
  await app.init();
  await app.listen(0);

  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${API_BASE}`;

  return { app, prisma, baseUrl };
}

export async function closeHarness(harness: E2EHarness): Promise<void> {
  await harness.app.close();
  await harness.prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface E2EResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export async function call<T>(
  harness: E2EHarness,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<E2EResponse<T>> {
  const hasBody = options.body !== undefined && method !== 'GET';
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });

  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: response.status, body, headers: response.headers };
}

/** `data` of a successful answer, with the status asserted on the way. */
export function dataOf<T>(response: E2EResponse<{ data: T }>, expected = 200): T {
  if (response.status !== expected) {
    throw new Error(
      `expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return response.body.data;
}

export interface Account {
  token: string;
  userId: string;
}

/** WeChat login through the mock adapter: a real session, a real account. */
export async function login(harness: E2EHarness, code: string): Promise<Account> {
  const response = await call<{ data: { accessToken: string; user: { id: string } } }>(
    harness,
    'POST',
    '/auth/wechat/login',
    { body: { code: `${code}-${randomUUID()}` } },
  );
  const session = dataOf(response, 201);
  return { token: session.accessToken, userId: session.user.id };
}

/**
 * The first administrator, through the product's own bootstrap route (T019) —
 * an E2E test must never create an operator by writing to the database.
 */
export async function bootstrapAdmin(harness: E2EHarness, code = 'admin'): Promise<Account> {
  const account = await login(harness, code);
  const response = await call(harness, 'POST', '/admin/bootstrap', { token: account.token });
  if (![200, 403].includes(response.status)) {
    throw new Error(`bootstrap: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return account;
}

// ---------------------------------------------------------------------------
// Journeys shared by several flows
// ---------------------------------------------------------------------------

export interface Mentor {
  owner: Account;
  providerId: string;
  serviceId: string;
  priceMinor: number;
  startAt: string;
  endAt: string;
  capabilityIds: string[];
}

export interface MentorOptions {
  capabilityTypes?: string[];
  priceMinor?: number;
  subjectCodes?: string[];
  /** Skip the parts a flow wants to do itself (verification, publication). */
  approve?: boolean;
  publish?: boolean;
  availability?: boolean;
}

/** Idempotent taxonomy term: journeys name what they teach. */
export async function ensureTerm(
  harness: E2EHarness,
  type: 'SUBJECT' | 'GRADE' | 'SKILL' | 'CITY',
  code: string,
  name: string,
): Promise<void> {
  await harness.prisma.taxonomyTerm.upsert({
    where: { type_code: { type, code } },
    create: { type, code, name, active: true },
    update: {},
  });
}

/**
 * Provider onboarding through the API: application, verification, admin
 * approval, service and availability.
 *
 * Verification cases are approved by an admin because that is the only way a
 * case reaches `APPROVED`; nothing is inserted behind the platform's back.
 */
export async function onboardMentor(
  harness: E2EHarness,
  admin: Account,
  code: string,
  options: MentorOptions = {},
): Promise<Mentor> {
  const capabilityTypes = options.capabilityTypes ?? ['STUDENT_TUTOR'];
  const priceMinor = options.priceMinor ?? 20_000;
  const subjectCodes = options.subjectCodes ?? ['MATH'];

  // The disposable database is rebuilt from the migrations without seed data, so
  // a journey brings the taxonomy it names.
  for (const code of subjectCodes) {
    await ensureTerm(harness, 'SUBJECT', code, '数学');
  }

  const owner = await login(harness, code);
  const application = dataOf(
    await call<{ data: { id: string } }>(harness, 'POST', '/providers/applications', {
      token: owner.token,
      body: { publicName: '李老师', cityCode: 'BEIJING', capabilityTypes },
    }),
    201,
  );
  const providerId = application.id;

  await call(harness, 'POST', '/providers/me/submit', { token: owner.token, body: {} });

  // Identity and education: both are required before anyone can be discovered.
  for (const verificationType of ['IDENTITY', 'EDUCATION']) {
    const created = dataOf(
      await call<{ data: { id: string } }>(harness, 'POST', '/verification/cases', {
        token: owner.token,
        body: { verificationType },
      }),
      201,
    );
    dataOf(
      await call<{ data: { documentId: string } }>(
        harness,
        'POST',
        `/verification/cases/${created.id}/documents/upload-url`,
        {
          token: owner.token,
          body: {
            documentType: verificationType === 'IDENTITY' ? 'ID_CARD' : 'DIPLOMA',
            contentType: 'image/jpeg',
            byteSize: 1_024,
            fileHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
          },
        },
      ),
      201,
    );

    const submitted = dataOf(
      await call<{ data: { status: string } }>(
        harness,
        'POST',
        `/verification/cases/${created.id}/submit`,
        { token: owner.token, body: {} },
      ),
      200,
    );
    expect(submitted.status).toBe('SUBMITTED');

    const approved = dataOf(
      await call<{ data: { status: string } }>(
        harness,
        'POST',
        `/admin/verifications/${created.id}/approve`,
        { token: admin.token, body: { reasonCode: 'DOCUMENTS_VERIFIED' } },
      ),
      200,
    );
    expect(approved.status).toBe('APPROVED');
  }

  if (options.approve !== false) {
    await call(harness, 'POST', `/admin/providers/${providerId}/approve`, {
      token: admin.token,
      body: { reason: '材料齐全' },
    });
  }

  const service = dataOf(
    await call<{ data: { id: string } }>(harness, 'POST', '/providers/me/services', {
      token: owner.token,
      body: {
        title: '数学一对一',
        durationMinutes: 60,
        priceMinor,
        subjectCodes,
      },
    }),
    201,
  );

  if (options.publish !== false) {
    await call(harness, 'POST', `/providers/me/services/${service.id}/publish`, {
      token: owner.token,
      body: {},
    });
  }

  const startAt = new Date(Date.now() + 72 * 60 * 60_000);
  const endAt = new Date(startAt.getTime() + 60 * 60_000);
  if (options.availability !== false) {
    await call(harness, 'POST', '/providers/me/availability', {
      token: owner.token,
      body: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    });
  }

  const capabilities = await harness.prisma.providerCapability.findMany({
    where: { providerId },
    select: { id: true },
  });

  return {
    owner,
    providerId,
    serviceId: service.id,
    priceMinor,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    capabilityIds: capabilities.map((capability) => capability.id),
  };
}

export interface PlacedOrder {
  id: string;
  orderNo: string;
}

/** Book and pay: the payment callback of the mock gateway closes the order. */
export async function placeOrder(
  harness: E2EHarness,
  buyer: Account,
  mentor: Mentor,
  extra: Record<string, unknown> = {},
): Promise<PlacedOrder> {
  const order = dataOf(
    await call<{ data: { id: string; orderNo: string } }>(harness, 'POST', '/orders', {
      token: buyer.token,
      body: {
        serviceId: mentor.serviceId,
        scheduledStart: mentor.startAt,
        scheduledEnd: mentor.endAt,
        ...extra,
      },
    }),
    201,
  );
  return { id: order.id, orderNo: order.orderNo };
}

export async function payOrder(
  harness: E2EHarness,
  buyer: Account,
  order: PlacedOrder,
  amountMinor?: number,
): Promise<{ providerTransactionId: string }> {
  const session = dataOf(
    await call<{ data: { providerTransactionId: string } }>(
      harness,
      'POST',
      `/orders/${order.id}/payment-session`,
      { token: buyer.token, body: {} },
    ),
    201,
  );

  await notifyPayment(harness, order, session.providerTransactionId, amountMinor);
  return session;
}

/** `POST /payments/wechat/notify`: the gateway calling back. */
export async function notifyPayment(
  harness: E2EHarness,
  order: PlacedOrder,
  providerTransactionId: string,
  amountMinor?: number,
): Promise<E2EResponse<{ data: { applied: boolean; orderStatus: string } }>> {
  return call<{ data: { applied: boolean; orderStatus: string } }>(
    harness,
    'POST',
    '/payments/wechat/notify',
    {
      body: {
        orderNo: order.orderNo,
        providerTransactionId,
        amountMinor: amountMinor ?? 20_000,
        status: 'SUCCEEDED',
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Remove everything a journey created.
 *
 * E2E tests share one database with the integration suite, so a flow leaves
 * nothing behind — and the assertions stay meaningful for the next one.
 */
export async function resetPlatform(harness: E2EHarness): Promise<void> {
  await harness.prisma.review.deleteMany();
  await harness.prisma.refund.deleteMany();
  await harness.prisma.payment.deleteMany();
  await harness.prisma.order.deleteMany();
  await harness.prisma.conversation.deleteMany();
  await harness.prisma.moderationCase.deleteMany();
  await harness.prisma.report.deleteMany();
  await harness.prisma.platformRule.deleteMany();
  await harness.prisma.availabilitySlot.deleteMany();
  await harness.prisma.service.deleteMany();
  await harness.prisma.verificationCase.deleteMany();
  await harness.prisma.providerCapability.deleteMany();
  await harness.prisma.providerProfile.deleteMany();
  await harness.prisma.consent.deleteMany();
  await harness.prisma.childProfile.deleteMany();
  await harness.prisma.auditLog.deleteMany();
  await harness.prisma.featureFlag.deleteMany();
  await harness.prisma.session.deleteMany();
  await harness.prisma.userRole.deleteMany();
  await harness.prisma.user.deleteMany();
  await harness.prisma.taxonomyTerm.deleteMany();
}
