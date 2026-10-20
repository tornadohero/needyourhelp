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
import { CONSOLE_CREDENTIAL_REPOSITORY } from '../../src/modules/auth/domain/console-credential.repository';
import {
  CONSOLE_PASSWORD_HASHER,
  ScryptPasswordHasher,
} from '../../src/modules/auth/domain/password-hasher';
import { PrismaConsoleCredentialRepository } from '../../src/modules/auth/infrastructure/prisma-console-credential.repository';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/modules/auth/http/guards/roles.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { TaxonomyAdminService } from '../../src/modules/catalog/application/taxonomy-admin.service';
import { TAXONOMY_REPOSITORY } from '../../src/modules/catalog/domain/taxonomy.repository';
import { AdminTaxonomyController } from '../../src/modules/catalog/http/admin-taxonomy.controller';
import { PrismaTaxonomyRepository } from '../../src/modules/catalog/infrastructure/prisma-taxonomy.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T008 admin taxonomy endpoints
 * (`specs/05-api-spec.md` §Taxonomy, `specs/12-admin-spec.md` §Admin
 * principles; `specs/14-test-strategy.md` §API tests):
 *
 * - authenticated success, unauthenticated failure, wrong-role failure,
 *   invalid input, unknown target;
 * - create/update/archive all write an audit row with a before/after snapshot;
 * - archive is idempotent and never deletes a term.
 */
describeWithDatabase('admin taxonomy HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, AdminTaxonomyController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        TaxonomyAdminService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: TAXONOMY_REPOSITORY, useClass: PrismaTaxonomyRepository },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'taxonomy-e2e-secret',
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
            openidPepper: 'taxonomy-e2e-pepper',
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
    await prisma.taxonomyTerm.deleteMany({ where: { code: { startsWith: 'T008_' } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
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
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t008-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  async function loginAsAdmin(): Promise<{ token: string; userId: string }> {
    const account = await login();
    await prisma.userRole.upsert({
      where: { userId_role: { userId: account.userId, role: 'ADMIN' } },
      create: { userId: account.userId, role: 'ADMIN' },
      update: {},
    });
    return account;
  }

  function termCode(prefix: string): string {
    return `T008_${prefix}_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
  }

  interface TermBody {
    data: {
      id: string;
      type: string;
      code: string;
      name: string;
      parentId: string | null;
      active: boolean;
    };
  }

  it('rejects unauthenticated taxonomy requests', async () => {
    const list = await request<ErrorBody>('GET', '/admin/taxonomy');
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe('AUTH_REQUIRED');

    const create = await request<ErrorBody>('POST', '/admin/taxonomy', {
      body: { type: 'SUBJECT', code: 'MATH', name: '数学' },
    });
    expect(create.status).toBe(401);

    const archive = await request<ErrorBody>('POST', `/admin/taxonomy/${randomUUID()}/archive`);
    expect(archive.status).toBe(401);
  });

  it('refuses taxonomy management without the admin role', async () => {
    const account = await login();

    const list = await request<ErrorBody>('GET', '/admin/taxonomy', { token: account.token });
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('FORBIDDEN');

    const create = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: account.token,
      body: { type: 'SUBJECT', code: termCode('X'), name: '数学' },
    });
    expect(create.status).toBe(403);

    const patch = await request<ErrorBody>('PATCH', `/admin/taxonomy/${randomUUID()}`, {
      token: account.token,
      body: { name: '数学' },
    });
    expect(patch.status).toBe(403);
  });

  it('creates, updates and archives a term with an audit row each', async () => {
    const admin = await loginAsAdmin();

    const created = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: termCode('MATH'), name: '数学' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.active).toBe(true);
    expect(created.body.data.parentId).toBeNull();
    const id = created.body.data.id;

    const updated = await request<TermBody>('PATCH', `/admin/taxonomy/${id}`, {
      token: admin.token,
      body: { name: '数学（新版）' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('数学（新版）');

    const archived = await request<TermBody>('POST', `/admin/taxonomy/${id}/archive`, {
      token: admin.token,
    });
    expect(archived.status).toBe(200);
    expect(archived.body.data.active).toBe(false);

    const rows = await prisma.auditLog.findMany({
      where: { resourceType: 'taxonomy_term', resourceId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.action)).toEqual([
      'TAXONOMY_CREATED',
      'TAXONOMY_UPDATED',
      'TAXONOMY_ARCHIVED',
    ]);
    expect(rows[0]?.actorUserId).toBe(admin.userId);
    expect(rows[0]?.actorType).toBe('ADMIN');
    expect(rows[0]?.beforeJson).toBeNull();
    expect(rows[0]?.afterJson).toMatchObject({ type: 'SUBJECT', active: true });
    expect(rows[1]?.beforeJson).toMatchObject({ name: '数学' });
    expect(rows[1]?.afterJson).toMatchObject({ name: '数学（新版）' });
    expect(rows[2]?.beforeJson).toMatchObject({ active: true });
    expect(rows[2]?.afterJson).toMatchObject({ active: false });
    expect(rows[0]?.requestId).toBeTruthy();

    // Archived, never deleted: `service_terms` and order snapshots depend on it.
    expect(await prisma.taxonomyTerm.findUnique({ where: { id } })).not.toBeNull();
  });

  it('archives idempotently and restores through a patch', async () => {
    const admin = await loginAsAdmin();
    const created = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'GRADE', code: termCode('GRADE'), name: '小学一年级' },
    });
    const id = created.body.data.id;

    await request<TermBody>('POST', `/admin/taxonomy/${id}/archive`, { token: admin.token });
    await request<TermBody>('POST', `/admin/taxonomy/${id}/archive`, { token: admin.token });

    const archivedRows = await prisma.auditLog.findMany({
      where: { resourceId: id, action: 'TAXONOMY_ARCHIVED' },
    });
    expect(archivedRows).toHaveLength(1);

    const restored = await request<TermBody>('PATCH', `/admin/taxonomy/${id}`, {
      token: admin.token,
      body: { active: true },
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.active).toBe(true);
  });

  it('lists a bounded page with filters', async () => {
    const admin = await loginAsAdmin();
    const parentCode = termCode('PARENT');
    const parent = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SKILL', code: parentCode, name: '作业辅导' },
    });
    await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: {
        type: 'SKILL',
        code: termCode('CHILD'),
        name: '作业辅导-初级',
        parentId: parent.body.data.id,
      },
    });
    await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'CITY', code: termCode('CITY'), name: '测试市' },
    });

    const list = await request<{
      data: {
        items: { id: string; type: string; parentId: string | null }[];
        page: number;
        pageSize: number;
        total: number;
      };
    }>('GET', `/admin/taxonomy?type=SKILL&pageSize=50`, { token: admin.token });

    expect(list.status).toBe(200);
    expect(list.body.data.page).toBe(1);
    expect(list.body.data.pageSize).toBe(50);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.items.every((item) => item.type === 'SKILL')).toBe(true);

    const children = await request<{ data: { items: { id: string }[]; total: number } }>(
      'GET',
      `/admin/taxonomy?type=SKILL&parentId=${parent.body.data.id}&pageSize=50`,
      { token: admin.token },
    );
    expect(children.body.data.total).toBe(1);

    const paged = await request<{ data: { items: unknown[]; total: number } }>(
      'GET',
      '/admin/taxonomy?page=2&pageSize=1',
      { token: admin.token },
    );
    expect(paged.body.data.items).toHaveLength(1);

    const active = await request<{ data: { items: { active: boolean }[] } }>(
      'GET',
      '/admin/taxonomy?active=true&pageSize=100',
      { token: admin.token },
    );
    expect(active.body.data.items.every((item) => item.active)).toBe(true);
  });

  it('rejects invalid taxonomy input', async () => {
    const admin = await loginAsAdmin();

    const badType = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'LANGUAGE', code: termCode('X'), name: '语文' },
    });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe('VALIDATION_ERROR');

    const badCode = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: '数学', name: '数学' },
    });
    expect(badCode.status).toBe(400);

    const missingName = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: termCode('X') },
    });
    expect(missingName.status).toBe(400);

    // `code` is immutable and `active` is server-owned on create.
    const extraField = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: termCode('X'), name: '数学', active: false },
    });
    expect(extraField.status).toBe(400);
    expect(extraField.body.error.code).toBe('VALIDATION_ERROR');

    const badParent = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: termCode('X'), name: '数学', parentId: 'not-a-uuid' },
    });
    expect(badParent.status).toBe(400);

    const unknownParent = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: {
        type: 'SUBJECT',
        code: termCode('X'),
        name: '数学',
        parentId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(unknownParent.status).toBe(404);
    expect(unknownParent.body.error.code).toBe('NOT_FOUND');

    const badQuery = await request<ErrorBody>('GET', '/admin/taxonomy?pageSize=0', {
      token: admin.token,
    });
    expect(badQuery.status).toBe(400);

    const badActive = await request<ErrorBody>('GET', '/admin/taxonomy?active=maybe', {
      token: admin.token,
    });
    expect(badActive.status).toBe(400);
  });

  it('rejects a duplicate (type, code) pair', async () => {
    const admin = await loginAsAdmin();
    const code = termCode('DUP');

    const first = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code, name: '数学' },
    });
    expect(first.status).toBe(201);

    const second = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code, name: '数学课' },
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('VALIDATION_ERROR');

    // The same code in another type is a different term.
    const otherType = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SKILL', code, name: '数学思维' },
    });
    expect(otherType.status).toBe(201);
  });

  it('keeps the hierarchy inside one type', async () => {
    const admin = await loginAsAdmin();
    const city = await request<TermBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'CITY', code: termCode('BJ'), name: '北京' },
    });

    const crossType = await request<ErrorBody>('POST', '/admin/taxonomy', {
      token: admin.token,
      body: { type: 'SUBJECT', code: termCode('SUB'), name: '数学', parentId: city.body.data.id },
    });
    expect(crossType.status).toBe(400);
  });

  it('returns NOT_FOUND for an unknown or malformed term id', async () => {
    const admin = await loginAsAdmin();

    for (const id of [randomUUID(), 'not-a-uuid']) {
      const patch = await request<ErrorBody>('PATCH', `/admin/taxonomy/${id}`, {
        token: admin.token,
        body: { name: '数学' },
      });
      expect(patch.status).toBe(404);
      expect(patch.body.error.code).toBe('NOT_FOUND');

      const archive = await request<ErrorBody>('POST', `/admin/taxonomy/${id}/archive`, {
        token: admin.token,
      });
      expect(archive.status).toBe(404);
    }
  });
});
