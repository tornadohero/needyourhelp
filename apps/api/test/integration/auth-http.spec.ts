import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Controller, Get, UseGuards, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { sha256Hex } from '../../src/common/security/hash';
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
import { Roles } from '../../src/modules/auth/http/decorators/roles.decorator';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level auth tests (`specs/05-api-spec.md` §Auth,
 * `specs/14-test-strategy.md` §API tests): authenticated success, unauthenticated
 * failure, wrong-role failure and invalid input.
 */

const ACCESS_SECRET = 'e2e-access-secret';

/** Test-only route used to exercise RBAC end to end (not a product endpoint). */
@Controller('test')
class RoleProtectedController {
  @Get('admin-only')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}

describeWithDatabase('auth HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  let tokens: JwtAccessTokenService;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    tokens = new JwtAccessTokenService({
      secret: ACCESS_SECRET,
      ttlSeconds: 900,
      issuer: 'mentor-platform',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, RoleProtectedController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: ACCESS_TOKEN_SERVICE, useValue: tokens },
        {
          provide: WECHAT_AUTH_PROVIDER,
          useValue: new MockWeChatAuthProvider({ environment: 'test' }),
        },
        {
          provide: AUTH_CONFIG,
          useValue: {
            accessTokenTtlSeconds: 900,
            refreshTokenTtlSeconds: 86_400,
            openidPepper: 'e2e-pepper',
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
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function post<T>(
    path: string,
    body: unknown,
    token?: string,
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function get<T>(path: string, token?: string): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  interface LoginBody {
    data: {
      tokenType: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: { id: string; displayName: string; avatarUrl: string | null; roles: string[] };
    };
  }

  interface ErrorBody {
    error: { code: string; message: string };
  }

  it('logs in with a WeChat code and returns only server-assigned roles', async () => {
    const response = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });

    expect(response.status).toBe(201);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.user.roles).toEqual(['USER']);
    expect(response.body.data.expiresIn).toBeGreaterThan(0);
    userIds.push(response.body.data.user.id);
  });

  it('rejects any client-supplied role or userId field', async () => {
    const response = await post<ErrorBody>('/auth/wechat/login', {
      code: `e2e-${randomUUID()}`,
      role: 'ADMIN',
      userId: 'someone-else',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty login code', async () => {
    const response = await post<ErrorBody>('/auth/wechat/login', { code: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the authenticated subject on GET /me', async () => {
    const login = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });
    userIds.push(login.body.data.user.id);

    const me = await get<{
      data: {
        id: string;
        roles: string[];
        status: string;
        displayName: string;
        avatarUrl: string | null;
      };
    }>('/me', login.body.data.accessToken);

    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(login.body.data.user.id);
    expect(me.body.data.roles).toEqual(['USER']);
    expect(Object.keys(me.body.data).sort()).toEqual(
      ['avatarUrl', 'displayName', 'id', 'roles', 'status'].sort(),
    );
  });

  it('rejects GET /me without credentials', async () => {
    const response = await get<ErrorBody>('/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects GET /me with a tampered token', async () => {
    const response = await get<ErrorBody>('/me', 'not-a-token');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rotates tokens and invalidates the previous refresh token', async () => {
    const login = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });
    userIds.push(login.body.data.user.id);

    const refreshed = await post<{ data: { accessToken: string; refreshToken: string } }>(
      '/auth/refresh',
      { refreshToken: login.body.data.refreshToken },
    );
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.data.refreshToken).not.toBe(login.body.data.refreshToken);

    const replay = await post<ErrorBody>('/auth/refresh', {
      refreshToken: login.body.data.refreshToken,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a refresh without a token', async () => {
    const response = await post<ErrorBody>('/auth/refresh', {});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs out by refresh token and blocks the access token afterwards', async () => {
    const login = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });
    userIds.push(login.body.data.user.id);

    const logout = await post<{ data: { revoked: boolean } }>('/auth/logout', {
      refreshToken: login.body.data.refreshToken,
    });
    expect(logout.status).toBe(201);
    expect(logout.body.data.revoked).toBe(true);

    const me = await get<ErrorBody>('/me', login.body.data.accessToken);
    expect(me.status).toBe(401);
  });

  it('rejects a logout for an already revoked session', async () => {
    const login = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });
    userIds.push(login.body.data.user.id);
    await post('/auth/logout', { refreshToken: login.body.data.refreshToken });

    const second = await post<ErrorBody>('/auth/logout', {
      refreshToken: login.body.data.refreshToken,
    });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('enforces role policy: USER is forbidden on an ADMIN route', async () => {
    const login = await post<LoginBody>('/auth/wechat/login', { code: `e2e-${randomUUID()}` });
    userIds.push(login.body.data.user.id);

    const response = await get<ErrorBody>('/test/admin-only', login.body.data.accessToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('enforces role policy: ADMIN is allowed on an ADMIN route', async () => {
    const admin = await prisma.user.create({ data: { displayName: `e2e-admin-${randomUUID()}` } });
    await prisma.userRole.create({ data: { userId: admin.id, role: 'ADMIN' } });
    userIds.push(admin.id);

    const session = await prisma.session.create({
      data: {
        userId: admin.id,
        refreshTokenHash: sha256Hex(`e2e-admin-${randomUUID()}`),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const accessToken = await tokens.issue({
      userId: admin.id,
      sessionId: session.id,
      jti: randomUUID(),
      expiresAt: new Date(Date.now() + 900_000),
    });

    const response = await get<{ data: { ok: boolean } }>('/test/admin-only', accessToken.token);
    expect(response.status).toBe(200);
    expect(response.body.data.ok).toBe(true);
  });

  it('rejects an unauthenticated request to the role-protected route', async () => {
    const response = await get<ErrorBody>('/test/admin-only');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});
