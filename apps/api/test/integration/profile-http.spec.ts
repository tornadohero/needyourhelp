import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_BASE, type ConsentTypeName } from '@mentor/api-contracts';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { ACCESS_TOKEN_SERVICE } from '../../src/modules/auth/domain/access-token.service';
import { AUTH_CONFIG, AUTH_SERVICE, AuthService } from '../../src/modules/auth/domain/auth.service';
import { SESSION_REPOSITORY } from '../../src/modules/auth/domain/session.repository';
import { WECHAT_AUTH_PROVIDER } from '../../src/modules/auth/domain/wechat-auth.provider';
import { AuthController } from '../../src/modules/auth/http/auth.controller';
import { JwtAuthGuard } from '../../src/modules/auth/http/guards/jwt-auth.guard';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { CONSENT_REPOSITORY } from '../../src/modules/identity/domain/consent.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaConsentRepository } from '../../src/modules/identity/infrastructure/prisma-consent.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { ChildProfileService } from '../../src/modules/profile/application/child-profile.service';
import { ConsentService } from '../../src/modules/profile/application/consent.service';
import { ProfileService } from '../../src/modules/profile/application/profile.service';
import { CHILD_PROFILE_REPOSITORY } from '../../src/modules/profile/domain/child-profile.repository';
import { PARENT_PROFILE_REPOSITORY } from '../../src/modules/profile/domain/parent-profile.repository';
import { ChildrenController } from '../../src/modules/profile/http/children.controller';
import { ConsentsController } from '../../src/modules/profile/http/consents.controller';
import { ProfileController } from '../../src/modules/profile/http/profile.controller';
import { PrismaChildProfileRepository } from '../../src/modules/profile/infrastructure/prisma-child-profile.repository';
import { PrismaParentProfileRepository } from '../../src/modules/profile/infrastructure/prisma-parent-profile.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T004 endpoints (`specs/05-api-spec.md` §Profile,
 * `specs/14-test-strategy.md` §API tests):
 *
 * - authenticated success, unauthenticated failure, invalid input;
 * - guardian ownership (E2E-06 child isolation);
 * - consent captured with its policy version;
 * - child detail never leaves the guardian-scoped payload.
 */
describeWithDatabase('profile HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, ProfileController, ChildrenController, ConsentsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        ProfileService,
        ChildProfileService,
        ConsentService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: CONSENT_REPOSITORY, useClass: PrismaConsentRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: PARENT_PROFILE_REPOSITORY, useClass: PrismaParentProfileRepository },
        { provide: CHILD_PROFILE_REPOSITORY, useClass: PrismaChildProfileRepository },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'profile-e2e-secret',
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
            openidPepper: 'profile-e2e-pepper',
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
    await prisma.childProfile.deleteMany({ where: { guardianUserId: { in: userIds } } });
    await prisma.consent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.parentProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  /** Register/login a fresh account through the real login endpoint. */
  async function login(): Promise<string> {
    const response = await request<{
      data: { accessToken: string; user: { id: string } };
    }>('POST', '/auth/wechat/login', { body: { code: `t004-${randomUUID()}` } });
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return response.body.data.accessToken;
  }

  interface ProfileBody {
    data: {
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      parentProfile: {
        id: string;
        displayName: string;
        cityCode: string | null;
        timezone: string;
      } | null;
    };
  }

  interface ChildBody {
    data: {
      id: string;
      nickname: string;
      birthYear: number | null;
      gradeCode: string | null;
      schoolName: string | null;
      learningGoals: string | null;
      consentStatus: string;
      createdAt: string;
    };
  }

  it('rejects an unauthenticated profile read', async () => {
    const response = await request<ErrorBody>('GET', '/me/profile');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects an unauthenticated child list', async () => {
    const response = await request<ErrorBody>('GET', '/me/children');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('reads and updates the caller’s own profile (AT-002)', async () => {
    const token = await login();

    const initial = await request<ProfileBody>('GET', '/me/profile', { token });
    expect(initial.status).toBe(200);
    expect(Object.keys(initial.body.data).sort()).toEqual(
      ['avatarUrl', 'displayName', 'parentProfile', 'userId'].sort(),
    );
    expect(initial.body.data.parentProfile).toBeNull();

    const updated = await request<ProfileBody>('PUT', '/me/profile', {
      token,
      body: { displayName: '家长小李', cityCode: 'BEIJING' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.displayName).toBe('家长小李');
    expect(updated.body.data.parentProfile?.cityCode).toBe('BEIJING');
    expect(updated.body.data.parentProfile?.timezone).toBe('Asia/Shanghai');

    const reread = await request<ProfileBody>('GET', '/me/profile', { token });
    expect(reread.body.data.parentProfile?.cityCode).toBe('BEIJING');
  });

  it('rejects client-supplied fields that are not part of the profile DTO', async () => {
    const token = await login();

    const response = await request<ErrorBody>('PUT', '/me/profile', {
      token,
      body: { displayName: 'x', role: 'ADMIN', userId: 'someone-else' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid profile input', async () => {
    const token = await login();

    const emptyName = await request<ErrorBody>('PUT', '/me/profile', {
      token,
      body: { displayName: '' },
    });
    expect(emptyName.status).toBe(400);
    expect(emptyName.body.error.code).toBe('VALIDATION_ERROR');

    const badCity = await request<ErrorBody>('PUT', '/me/profile', {
      token,
      body: { cityCode: 'beijing city!' },
    });
    expect(badCity.status).toBe(400);
  });

  it('creates a child profile and records the consent version (AT-020)', async () => {
    const token = await login();

    const created = await request<ChildBody>('POST', '/me/children', {
      token,
      body: {
        nickname: '小明',
        birthYear: 2016,
        gradeCode: 'GRADE_4',
        schoolName: '实验小学',
        learningGoals: '数学基础',
        consentPolicyVersion: '2026-09-01',
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.consentStatus).toBe('GRANTED');
    expect(Object.keys(created.body.data).sort()).toEqual(
      [
        'birthYear',
        'consentStatus',
        'createdAt',
        'gradeCode',
        'id',
        'learningGoals',
        'nickname',
        'schoolName',
      ].sort(),
    );

    const consents = await request<{
      data: {
        consents: {
          consentType: ConsentTypeName;
          policyVersion: string;
          granted: boolean;
          revokedAt: string | null;
        }[];
      };
    }>('GET', '/me/consents', { token });

    const guardianConsent = consents.body.data.consents.find(
      (consent) => consent.consentType === 'MINOR_GUARDIAN',
    );
    expect(guardianConsent?.policyVersion).toBe('2026-09-01');
    expect(guardianConsent?.granted).toBe(true);
    expect(guardianConsent?.revokedAt).toBeNull();
  });

  it('requires guardian consent before creating a child profile', async () => {
    const token = await login();

    const response = await request<ErrorBody>('POST', '/me/children', {
      token,
      body: { nickname: '小明' },
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('rejects invalid child input', async () => {
    const token = await login();

    const response = await request<ErrorBody>('POST', '/me/children', {
      token,
      body: { nickname: '', consentPolicyVersion: 'v1', guardianUserId: 'someone-else' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('isolates child profiles between guardians (E2E-06)', async () => {
    const parentA = await login();
    const parentB = await login();

    const child = await request<ChildBody>('POST', '/me/children', {
      token: parentA,
      body: { nickname: '小明', schoolName: '实验小学', consentPolicyVersion: 'v1' },
    });
    expect(child.status).toBe(201);

    for (const path of [`/me/children/${child.body.data.id}`]) {
      const read = await request<ErrorBody>('GET', path, { token: parentB });
      expect(read.status).toBe(403);
      expect(read.body.error.code).toBe('CHILD_ACCESS_DENIED');

      const patch = await request<ErrorBody>('PATCH', path, {
        token: parentB,
        body: { nickname: 'hacked' },
      });
      expect(patch.status).toBe(403);
      expect(patch.body.error.code).toBe('CHILD_ACCESS_DENIED');

      const remove = await request<ErrorBody>('DELETE', path, { token: parentB });
      expect(remove.status).toBe(403);
      expect(remove.body.error.code).toBe('CHILD_ACCESS_DENIED');
    }

    // Parent B never sees the child in their own list.
    const listB = await request<{ data: { children: unknown[] } }>('GET', '/me/children', {
      token: parentB,
    });
    expect(listB.body.data.children).toHaveLength(0);

    // And no child detail leaks through the profile payload.
    const profileB = await request<ProfileBody>('GET', '/me/profile', { token: parentB });
    expect(JSON.stringify(profileB.body)).not.toContain('实验小学');

    // The guardian still can.
    const read = await request<ChildBody>('GET', `/me/children/${child.body.data.id}`, {
      token: parentA,
    });
    expect(read.status).toBe(200);
    expect(read.body.data.schoolName).toBe('实验小学');
  });

  it('returns NOT_FOUND for an unknown or deleted child', async () => {
    const token = await login();

    const unknown = await request<ErrorBody>('GET', `/me/children/${randomUUID()}`, { token });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });

  it('soft-deletes a child profile and keeps it out of later reads', async () => {
    const token = await login();

    const child = await request<ChildBody>('POST', '/me/children', {
      token,
      body: { nickname: '小明', consentPolicyVersion: 'v1' },
    });

    const removed = await request<{ data: { id: string; deleted: boolean } }>(
      'DELETE',
      `/me/children/${child.body.data.id}`,
      { token },
    );
    expect(removed.status).toBe(200);
    expect(removed.body.data.deleted).toBe(true);

    const after = await request<ErrorBody>('GET', `/me/children/${child.body.data.id}`, { token });
    expect(after.status).toBe(404);

    // Soft delete: the row is still on disk for order history.
    expect(await prisma.childProfile.count({ where: { id: child.body.data.id } })).toBe(1);

    const repeated = await request<ErrorBody>('DELETE', `/me/children/${child.body.data.id}`, {
      token,
    });
    expect(repeated.status).toBe(404);
  });

  it('grants and withdraws a consent explicitly', async () => {
    const token = await login();

    const granted = await request<{ data: { consentType: string; policyVersion: string } }>(
      'POST',
      '/me/consents',
      { token, body: { consentType: 'MARKETING', policyVersion: '2026-09-01' } },
    );
    expect(granted.status).toBe(201);
    expect(granted.body.data.policyVersion).toBe('2026-09-01');

    const revoked = await request<{ data: { revokedAt: string | null } }>(
      'DELETE',
      '/me/consents/MARKETING',
      { token },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.revokedAt).not.toBeNull();

    const again = await request<ErrorBody>('DELETE', '/me/consents/MARKETING', { token });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an unknown consent type and a non-grant', async () => {
    const token = await login();

    const unknown = await request<ErrorBody>('POST', '/me/consents', {
      token,
      body: { consentType: 'NOT_A_CONSENT', policyVersion: 'v1' },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');

    const notGranted = await request<ErrorBody>('POST', '/me/consents', {
      token,
      body: { consentType: 'MARKETING', policyVersion: 'v1', granted: false },
    });
    expect(notGranted.status).toBe(403);
    expect(notGranted.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('withdrawing guardian consent blocks updates but keeps deletion available', async () => {
    const token = await login();

    const child = await request<ChildBody>('POST', '/me/children', {
      token,
      body: { nickname: '小明', consentPolicyVersion: 'v1' },
    });

    await request('DELETE', '/me/consents/MINOR_GUARDIAN', { token });

    const stale = await request<ChildBody>('GET', `/me/children/${child.body.data.id}`, { token });
    expect(stale.body.data.consentStatus).toBe('REVOKED');

    const patch = await request<ErrorBody>('PATCH', `/me/children/${child.body.data.id}`, {
      token,
      body: { nickname: 'x' },
    });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('CONSENT_REQUIRED');

    const remove = await request('DELETE', `/me/children/${child.body.data.id}`, { token });
    expect(remove.status).toBe(200);
  });
});
