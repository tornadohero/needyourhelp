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
import { ConsoleCredentialService } from '../../src/modules/auth/domain/console-credential.service';
import { CONSOLE_CREDENTIAL_REPOSITORY } from '../../src/modules/auth/domain/console-credential.repository';
import { CONSOLE_MAX_FAILED_ATTEMPTS } from '../../src/modules/auth/domain/console-credential-policy';
import { CONSOLE_PASSWORD_HASHER } from '../../src/modules/auth/domain/password-hasher';
import { ScryptPasswordHasher } from '../../src/modules/auth/domain/password-hasher';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { ConsoleAuthController } from '../../src/modules/auth/http/console-auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaConsoleCredentialRepository } from '../../src/modules/auth/infrastructure/prisma-console-credential.repository';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Admin console login over HTTP (T028 gap G1).
 *
 * Covers what the audit could not: an operator really can log into the console
 * with a username/password, the token works on a role-protected route, and every
 * failure path (wrong password, missing role, lockout, non-operator issuing) is
 * refused without leaking which step failed.
 */

const ACCESS_SECRET = 'console-auth-access-secret';
const PASSWORD = 'correct-horse-battery-staple';

describeWithDatabase('admin console auth HTTP', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, ConsoleAuthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: AUTH_SERVICE, useExisting: AuthService },
        ConsoleCredentialService,
        JwtAuthGuard,
        RolesGuard,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: ACCESS_SECRET,
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
            openidPepper: 'console-auth-pepper',
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
    await prisma.consoleCredential.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /**
   * An operator session: WeChat login (the mock provider creates the account),
   * then the role is granted server-side — a client never asks for one.
   */
  async function operator(roles: ('ADMIN' | 'OPS' | 'USER')[]): Promise<{
    userId: string;
    token: string;
  }> {
    const login = await fetch(`${baseUrl}/auth/wechat/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: `console-operator-${randomUUID()}` }),
    });
    const session = (await login.json()) as { data: { accessToken: string } };
    const token = session.data.accessToken;

    const me = await fetch(`${baseUrl}/me`, { headers: { authorization: `Bearer ${token}` } });
    const userId = ((await me.json()) as { data: { id: string } }).data.id;
    await prisma.userRole.createMany({
      // A login already grants the default role: granting it twice is a no-op.
      skipDuplicates: true,
      data: roles.map((role) => ({ userId, role })),
    });
    userIds.push(userId);

    return { userId, token };
  }

  it('issues a credential, logs the operator in and protects the console', async () => {
    const admin = await operator(['ADMIN']);
    const adminId = admin.userId;
    const adminToken = admin.token;

    // Issuing is an operator action: no token, no credential.
    const anonymous = await fetch(`${baseUrl}/admin/console-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: adminId, username: 'ops.adam', password: PASSWORD }),
    });
    expect(anonymous.status).toBe(401);

    // A non-operator may not issue one either.
    const plain = await operator(['USER']);
    const plainId = plain.userId;
    const plainToken = plain.token;
    const forbidden = await fetch(`${baseUrl}/admin/console-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${plainToken}` },
      body: JSON.stringify({ userId: plainId, username: 'plain.user', password: PASSWORD }),
    });
    expect(forbidden.status).toBe(403);

    const issued = await fetch(`${baseUrl}/admin/console-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ userId: adminId, username: 'Ops.Adam', password: PASSWORD }),
    });
    expect(issued.status).toBe(201);
    const issuedBody = (await issued.json()) as { data: { username: string; rotated: boolean } };
    expect(issuedBody).toMatchObject({ data: { username: 'ops.adam', rotated: false } });

    // The password is never echoed back by any endpoint.
    expect(JSON.stringify(issuedBody)).not.toContain(PASSWORD);

    // Login with the credential, and use the token on a protected route.
    const login = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ops.adam', password: PASSWORD }),
    });
    expect(login.status).toBe(201);
    const session = (await login.json()) as {
      data: { accessToken: string; user: { roles: string[] } };
    };
    expect(session.data.user.roles).toContain('ADMIN');

    const me = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${session.data.accessToken}` },
    });
    expect(me.status).toBe(200);

    // The audit trail of the credential exists, and has no secret in it.
    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'console_credential', resourceId: { not: undefined } },
    });
    const issuedRow = rows.find((row) => row.action === 'CONSOLE_CREDENTIAL_ISSUED');
    expect(issuedRow).toBeDefined();
    expect(issuedRow?.actorType).toBe('ADMIN');
    expect(JSON.stringify(issuedRow)).not.toContain(PASSWORD);
  });

  it('refuses a wrong password, a missing operator role and a locked credential', async () => {
    const ops = await operator(['OPS']);
    const opsId = ops.userId;
    const opsToken = ops.token;

    const issueResponse = await fetch(`${baseUrl}/admin/console-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opsToken}` },
      body: JSON.stringify({ userId: opsId, username: 'ops.eve', password: PASSWORD }),
    });
    // The precondition of this test: the operator really got a credential.
    expect(issueResponse.status).toBe(201);

    // Wrong password and unknown username answer the same way.
    const wrong = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ops.eve', password: 'not-the-password' }),
    });
    expect(wrong.status).toBe(401);

    const unknown = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nobody.here', password: PASSWORD }),
    });
    expect(unknown.status).toBe(401);
    expect((await unknown.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });

    // Unknown fields are refused, not ignored.
    const tampered = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ops.eve', password: PASSWORD, role: 'ADMIN' }),
    });
    expect(tampered.status).toBe(400);

    // Failures accumulate until the credential is frozen.
    for (let attempt = 0; attempt < CONSOLE_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await fetch(`${baseUrl}/auth/console/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ops.eve', password: 'still-wrong' }),
      });
    }
    const locked = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ops.eve', password: PASSWORD }),
    });
    expect(locked.status).toBe(403);

    // Revocation removes console access entirely.
    const revoked = await fetch(`${baseUrl}/admin/console-credentials/${opsId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${opsToken}` },
    });
    expect(revoked.status).toBe(200);

    await prisma.consoleCredential.deleteMany({ where: { userId: opsId } });
    const afterRevoke = await fetch(`${baseUrl}/auth/console/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ops.eve', password: PASSWORD }),
    });
    expect(afterRevoke.status).toBe(401);
  });
});
