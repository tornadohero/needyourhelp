import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { SecurityHeadersMiddleware } from '../../src/common/security/security-headers.middleware';
import { RequestSizeLimitMiddleware } from '../../src/common/security/request-size-limit.middleware';
import { RateLimitInterceptor } from '../../src/common/security/rate-limit.interceptor';
import { RATE_LIMITER } from '../../src/common/security/rate-limit.model';
import type { RateLimiter } from '../../src/common/security/rate-limit.model';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG } from '../../src/modules/auth/domain/auth.service';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { ProviderModule } from '../../src/modules/provider/provider.module';
import { DiscoveryModule } from '../../src/modules/discovery/discovery.module';
import { SecurityModule } from '../../src/common/security/security.module';
import { AdminModule } from '../../src/modules/admin/admin.module';
import { VerificationModule } from '../../src/modules/verification/verification.module';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AppController } from '../../src/app.controller';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/** Keys the limiter was asked about, and whether it denies everything. */
class SpyLimiter implements RateLimiter {
  readonly keys: string[] = [];
  denyFrom = Number.POSITIVE_INFINITY;

  async consume(key: string) {
    this.keys.push(key);
    const count = this.keys.filter((entry) => entry === key).length;
    const allowed = count < this.denyFrom;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : 30,
      limit: 5,
      remaining: allowed ? 5 - count : 0,
    };
  }
}

/**
 * Cross-cutting security (`specs/13-security-spec.md` §API and
 * §Security acceptance): secure headers, rate limiting, size limits, private
 * object access and field-level responses.
 */
describeWithDatabase('security hardening', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const limiter = new SpyLimiter();

  const userIds: string[] = [];
  const providerIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        ProviderModule,
        DiscoveryModule,
        VerificationModule,
        AdminModule,
        SecurityModule,
      ],
      controllers: [AppController],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RATE_LIMITER)
      .useValue(limiter)
      .overrideProvider(ACCESS_TOKEN_SERVICE)
      .useValue(
        new JwtAccessTokenService({
          secret: 'security-e2e-secret',
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
        openidPepper: 'security-e2e-pepper',
        defaultRoles: ['USER'],
      })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix(API_BASE.replace(/^\/+/, ''));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(
      new ResponseEnvelopeInterceptor(),
      app.get(RateLimitInterceptor, { strict: false }),
    );

    // The two middlewares are applied globally by `AppModule.configure`; here the
    // module does not run, so they are applied explicitly.
    const express = app.getHttpAdapter().getInstance();
    express.use((request: never, response: never, next: () => void) => {
      new SecurityHeadersMiddleware().use(request, response, next);
    });
    express.use((request: never, response: never, next: () => void) => {
      new RequestSizeLimitMiddleware().use(request, response, next);
    });

    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${API_BASE}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma.verificationCase.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.auditLog.deleteMany({ where: { resourceType: 'user_role' } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { token?: string; body?: unknown; rawBody?: string } = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const hasBody = options.body !== undefined || options.rawBody !== undefined;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
    });
    return {
      status: response.status,
      body: (await response.json()) as T,
      headers: response.headers,
    };
  }

  async function login(code: string): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t022-${code}-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  it('answers with the secure headers of specs/13', async () => {
    const response = await request<{ data: unknown }>('GET', '/health');

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    // Nothing that may carry personal data may be cached.
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('limits a route and says when to come back', async () => {
    const before = limiter.keys.length;

    const first = await request<{ data: unknown }>('GET', '/providers');
    expect(first.status).toBe(200);
    // The limit is reported even when the call is allowed.
    expect(first.headers.get('ratelimit-limit')).not.toBeNull();

    limiter.denyFrom = 1;
    const blocked = await request<ErrorBody>('GET', '/providers');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect(limiter.keys.length).toBeGreaterThan(before);

    limiter.denyFrom = Number.POSITIVE_INFINITY;
  });

  it('keys an account-scoped policy on the account, and an open one on the address', async () => {
    const account = await login('account-scoped');
    // Only the keys this test produces: the limiter is shared by the file.
    const mark = limiter.keys.length;

    const applied = await request('POST', '/providers/applications', {
      token: account.token,
      body: { publicName: '李老师', capabilityTypes: ['STUDENT_TUTOR'] },
    });
    if (applied.status !== 201) {
      throw new Error(`apply: ${applied.status} ${JSON.stringify(applied.body)}`);
    }
    const accountKeys = limiter.keys
      .slice(mark)
      .filter((key) => key.startsWith('applications.create'));
    expect(accountKeys.some((key) => key.includes(account.userId))).toBe(true);
    // The raw address is never part of a key either way (`AGENTS.md` §9).
    expect(accountKeys.some((key) => key.includes(':ip:'))).toBe(false);

    await request('GET', '/providers');
    const searchKeys = limiter.keys.slice(mark).filter((key) => key.startsWith('search.public'));
    expect(searchKeys.every((key) => key.includes(':ip:'))).toBe(true);
  });

  it('refuses a body that is too large', async () => {
    const response = await request<ErrorBody>('POST', '/providers/applications', {
      rawBody: JSON.stringify({ publicName: 'x'.repeat(300 * 1_024) }),
    });

    expect(response.status).toBe(413);
  });

  it('never exposes a private object key or a signed URL in a response', async () => {
    const owner = await login('documents');
    const application = await request<{ data: { id: string } }>('POST', '/providers/applications', {
      token: owner.token,
      body: { publicName: '李老师', capabilityTypes: ['STUDENT_TUTOR'] },
    });
    const providerId = application.body.data.id;
    providerIds.push(providerId);

    const created = await request<{ data: { id: string } }>('POST', '/verification/cases', {
      token: owner.token,
      body: { verificationType: 'IDENTITY' },
    });
    if (created.status !== 201) {
      throw new Error(`create case: ${created.status} ${JSON.stringify(created.body)}`);
    }

    // Upload: only whitelisted types, and only under the size limit.
    const refused = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      {
        token: owner.token,
        body: {
          documentType: 'ID_CARD',
          contentType: 'application/x-msdownload',
          byteSize: 1_024,
          fileHash: 'a'.repeat(64),
        },
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_ERROR');

    const tooLarge = await request<ErrorBody>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      {
        token: owner.token,
        body: {
          documentType: 'ID_CARD',
          contentType: 'image/jpeg',
          byteSize: 100 * 1_024 * 1_024,
          fileHash: 'a'.repeat(64),
        },
      },
    );
    expect(tooLarge.status).toBe(400);

    const accepted = await request<{ data: { documentId: string; uploadUrl: string } }>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      {
        token: owner.token,
        body: {
          documentType: 'ID_CARD',
          contentType: 'image/jpeg',
          byteSize: 1_024,
          fileHash: 'a'.repeat(64),
        },
      },
    );
    expect(accepted.status).toBe(201);

    // The upload URL is signed and short-lived; the object key behind it is
    // generated by the server, so two requests never point at the same object.
    const secondUrl = await request<{ data: { uploadUrl: string } }>(
      'POST',
      `/verification/cases/${created.body.data.id}/documents/upload-url`,
      {
        token: owner.token,
        body: {
          documentType: 'ID_CARD',
          contentType: 'image/jpeg',
          byteSize: 1_024,
          fileHash: 'b'.repeat(64),
        },
      },
    );
    if (!accepted.body.data.uploadUrl) {
      throw new Error(`upload response: ${JSON.stringify(accepted.body)}`);
    }
    if (!secondUrl.body.data.uploadUrl) {
      throw new Error(`second upload: ${secondUrl.status} ${JSON.stringify(secondUrl.body)}`);
    }
    expect(secondUrl.body.data.uploadUrl).not.toBe(accepted.body.data.uploadUrl);

    const mine = await request<{ data: unknown }>('GET', '/verification/me', {
      token: owner.token,
    });
    // What the platform stores and lists about a document: no key, no hash and
    // no URL — only what an admin may later open through a signed, audited link.
    const documents = JSON.stringify(mine.body);
    expect(documents).not.toContain('storageKey');
    expect(documents).not.toContain('fileHash');
    expect(documents).not.toContain('http');
  });

  it('keeps personal data out of every response field', async () => {
    const account = await login('field-level');
    await request('POST', '/providers/applications', {
      token: account.token,
      body: { publicName: '李老师', capabilityTypes: ['STUDENT_TUTOR'] },
    });

    const forbidden = [
      'phoneEncrypted',
      'phone_encrypted',
      'wechatOpenidHash',
      'wechat_openid_hash',
      'unionidHash',
      'unionid_hash',
      'idNumber',
      'id_number',
      'passwordHash',
      'refreshTokenHash',
      'accessToken',
      'refreshToken',
    ];

    const responses = [
      await request<unknown>('GET', '/me', { token: account.token }),
      await request<unknown>('GET', '/providers/me', { token: account.token }),
      await request<unknown>('GET', '/providers'),
      await request<unknown>('GET', '/auth/me', { token: account.token }).catch(() => null),
    ];

    for (const response of responses) {
      if (!response) {
        continue;
      }
      const serialized = JSON.stringify(response.body);
      for (const key of forbidden) {
        expect(serialized, `${response.status} ${key}`).not.toContain(key);
      }
    }
  });

  it('keeps admin routes behind the role', async () => {
    const customer = await login('customer-admin-route');

    const forbidden = await request<ErrorBody>('GET', '/admin/users', { token: customer.token });
    expect(forbidden.status).toBe(403);

    const anonymous = await request<ErrorBody>('GET', '/admin/users');
    expect(anonymous.status).toBe(401);
  });
});
