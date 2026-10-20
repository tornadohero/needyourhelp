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
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PROVIDER_DIRECTORY } from '../../src/modules/discovery/domain/provider-directory';
import { PrismaProviderDirectory } from '../../src/modules/discovery/infrastructure/prisma-provider.directory';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { BlockService } from '../../src/modules/messaging/application/block.service';
import { ConversationService } from '../../src/modules/messaging/application/conversation.service';
import { BLOCK_REPOSITORY } from '../../src/modules/messaging/domain/block.repository';
import { CONVERSATION_REPOSITORY } from '../../src/modules/messaging/domain/conversation.repository';
import { MESSAGING_GATEWAY } from '../../src/modules/messaging/domain/messaging-gateway';
import { MODERATION_REPOSITORY } from '../../src/modules/moderation/domain/moderation.repository';
import { BlockController } from '../../src/modules/messaging/http/block.controller';
import { ConversationController } from '../../src/modules/messaging/http/conversation.controller';
import { PrismaBlockRepository } from '../../src/modules/messaging/infrastructure/prisma-block.repository';
import { PrismaConversationRepository } from '../../src/modules/messaging/infrastructure/prisma-conversation.repository';
import { PrismaModerationRepository } from '../../src/modules/moderation/infrastructure/prisma-moderation.repository';
import { MockMessagingGateway } from '../../src/modules/messaging/infrastructure/mock-messaging.gateway';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * HTTP-level tests for the T012 endpoints (`specs/05-api-spec.md` §Messaging,
 * `specs/09-im-spec.md`, `specs/14-test-strategy.md` §API tests):
 *
 * - a block prevents a new conversation, in both directions, and freezes the
 *   pair's existing conversations;
 * - a report always creates a moderation case;
 * - a conversation is readable and reportable by its members only;
 * - no message content is ever stored or returned.
 */
describeWithDatabase('messaging HTTP endpoints', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];
  /** Provider profiles created in `beforeAll`, cleaned up in `afterAll`. */
  const providerIds: string[] = [];
  let providerId: string;
  let providerOwnerId: string;

  beforeAll(async () => {
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [AuthController, ConversationController, BlockController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: CONSOLE_CREDENTIAL_REPOSITORY, useClass: PrismaConsoleCredentialRepository },
        { provide: CONSOLE_PASSWORD_HASHER, useClass: ScryptPasswordHasher },
        { provide: AUTH_SERVICE, useExisting: AuthService },
        JwtAuthGuard,
        RolesGuard,
        ConversationService,
        BlockService,
        { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: PROVIDER_DIRECTORY, useClass: PrismaProviderDirectory },
        { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
        { provide: BLOCK_REPOSITORY, useClass: PrismaBlockRepository },
        { provide: MODERATION_REPOSITORY, useClass: PrismaModerationRepository },
        // The directory gates a flagged marketplace (T021).
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        {
          provide: MESSAGING_GATEWAY,
          useValue: new MockMessagingGateway({ environment: 'test' }),
        },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'messaging-e2e-secret',
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
            openidPepper: 'messaging-e2e-pepper',
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

    // A discoverable provider, so "target provider is discoverable" can pass.
    // The owner is a real logged-in account: a conversation about a provider
    // must include the provider.
    const owner = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: 't012-provider-owner' } },
    );
    userIds.push(owner.body.data.user.id);
    providerOwnerId = owner.body.data.user.id;

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerOwnerId,
        providerType: 'TUTORING',
        publicName: '李老师',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
      },
    });
    providerId = provider.id;
    providerIds.push(provider.id);
  });

  afterAll(async () => {
    await app?.close();
    await prisma.moderationCase.deleteMany({ where: { targetType: 'CONVERSATION' } });
    await prisma.report.deleteMany({ where: { reporterUserId: { in: userIds } } });
    await prisma.conversation.deleteMany({
      where: { members: { some: { userId: { in: userIds } } } },
    });
    await prisma.block.deleteMany({
      where: { OR: [{ blockerUserId: { in: userIds } }, { blockedUserId: { in: userIds } }] },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  interface ErrorBody {
    error: { code: string; message: string };
  }

  interface ConversationBody {
    data: {
      id: string;
      status: string;
      providerId?: string;
      members: { userId: string; role: string }[];
      messages: unknown[];
    };
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T; raw: string }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined || method === 'GET'
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined || method === 'GET'
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    return { status: response.status, body: JSON.parse(raw) as T, raw };
  }

  /** A logged-in account; returns the token and the user id. */
  async function login(): Promise<{ token: string; userId: string }> {
    const response = await request<{ data: { accessToken: string; user: { id: string } } }>(
      'POST',
      '/auth/wechat/login',
      { body: { code: `t012-${randomUUID()}` } },
    );
    expect(response.status).toBe(201);
    userIds.push(response.body.data.user.id);
    return { token: response.body.data.accessToken, userId: response.body.data.user.id };
  }

  it('requires a session for every messaging route', async () => {
    const paths: ['GET' | 'POST' | 'DELETE', string][] = [
      ['GET', '/conversations'],
      ['POST', '/conversations'],
      ['GET', `/conversations/${randomUUID()}`],
      ['POST', `/conversations/${randomUUID()}/report`],
      ['POST', `/users/${randomUUID()}/block`],
      ['DELETE', `/users/${randomUUID()}/block`],
    ];

    for (const [method, path] of paths) {
      const response = await request<ErrorBody>(method, path, { body: {} });
      expect(response.status, path).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    }
  });

  it('creates a conversation about a discoverable provider', async () => {
    const alice = await login();
    const ownerToken = (
      await request<{ data: { accessToken: string } }>('POST', '/auth/wechat/login', {
        body: { code: 't012-provider-owner' },
      })
    ).body.data.accessToken;

    const created = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: providerOwnerId, providerId },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('OPEN');
    expect(created.body.data.members).toHaveLength(2);
    expect(created.body.data.messages).toEqual([]);
    // No transport id and no message content is ever exposed.
    expect(created.raw).not.toContain('providerConversationId');

    const listed = await request<{ data: { items: { id: string }[]; total: number } }>(
      'GET',
      '/conversations',
      { token: alice.token },
    );
    expect(listed.body.data.items.map((item) => item.id)).toContain(created.body.data.id);

    // The provider owner is the other member, so they can read it too.
    const detail = await request<ConversationBody>(
      'GET',
      `/conversations/${created.body.data.id}`,
      { token: ownerToken },
    );
    expect(detail.status).toBe(200);
  });

  it('refuses a conversation with oneself, a stranger target or a hidden provider', async () => {
    const alice = await login();

    const self = await request<ErrorBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: alice.userId },
    });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('VALIDATION_ERROR');

    const unknown = await request<ErrorBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(unknown.status).toBe(400);

    // Not a uuid at all, and a client-supplied status.
    for (const body of [
      { peerUserId: 'not-a-uuid' },
      {
        peerUserId: alice.userId === '' ? '' : '33333333-3333-4333-8333-333333333333',
        providerId: 'not-a-uuid',
      },
      { peerUserId: '33333333-3333-4333-8333-333333333333', status: 'OPEN' },
    ]) {
      const response = await request<ErrorBody>('POST', '/conversations', {
        token: alice.token,
        body,
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('prevents a new conversation once a user is blocked, in both directions', async () => {
    const alice = await login();
    const bob = await login();

    const conversation = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });
    expect(conversation.status).toBe(201);

    const blocked = await request<{ data: { blockedUserId: string } }>(
      'POST',
      `/users/${bob.userId}/block`,
      { token: alice.token },
    );
    expect(blocked.status).toBe(201);
    expect(blocked.body.data.blockedUserId).toBe(bob.userId);

    // The existing conversation is frozen, not deleted: a moderator keeps it.
    expect(
      (await prisma.conversation.findUnique({ where: { id: conversation.body.data.id } }))?.status,
    ).toBe('BLOCKED');

    const byBlocker = await request<ErrorBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });
    expect(byBlocker.status).toBe(403);
    expect(byBlocker.body.error.code).toBe('BLOCKED_USER');

    // The blocked user cannot start one either.
    const byBlocked = await request<ErrorBody>('POST', '/conversations', {
      token: bob.token,
      body: { peerUserId: alice.userId },
    });
    expect(byBlocked.status).toBe(403);
    expect(byBlocked.body.error.code).toBe('BLOCKED_USER');

    // Unblocking restores messaging and re-opens what was frozen.
    const unblocked = await request<{ data: { blocked: boolean } }>(
      'DELETE',
      `/users/${bob.userId}/block`,
      { token: alice.token },
    );
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.data.blocked).toBe(false);
    expect(
      (await prisma.conversation.findUnique({ where: { id: conversation.body.data.id } }))?.status,
    ).toBe('OPEN');

    const again = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });
    expect(again.status).toBe(201);
  });

  it('creates a moderation case when a conversation is reported', async () => {
    const alice = await login();
    const bob = await login();
    const created = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });

    const report = await request<{
      data: { reportId: string; caseId: string; reasonCode: string; caseCreated: boolean };
    }>('POST', `/conversations/${created.body.data.id}/report`, {
      token: alice.token,
      body: { reasonCode: 'HARASSMENT', description: '骚扰内容' },
    });

    expect(report.status).toBe(201);
    expect(report.body.data).toMatchObject({ reasonCode: 'HARASSMENT', caseCreated: true });

    const storedCase = await prisma.moderationCase.findUnique({
      where: { id: report.body.data.caseId },
    });
    expect(storedCase).toMatchObject({
      targetType: 'CONVERSATION',
      targetId: created.body.data.id,
      status: 'OPEN',
      sourceReportId: report.body.data.reportId,
    });
    const storedReport = await prisma.report.findUnique({
      where: { id: report.body.data.reportId },
    });
    expect(storedReport).toMatchObject({ reporterUserId: alice.userId, status: 'PENDING' });

    // A second report of the same conversation reuses the active case.
    const second = await request<{ data: { caseCreated: boolean; caseId: string } }>(
      'POST',
      `/conversations/${created.body.data.id}/report`,
      { token: bob.token, body: { reasonCode: 'OTHER' } },
    );
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ caseCreated: false, caseId: report.body.data.caseId });
    expect(await prisma.moderationCase.count({ where: { targetId: created.body.data.id } })).toBe(
      1,
    );
  });

  it('keeps a conversation between its members only', async () => {
    const alice = await login();
    const bob = await login();
    const stranger = await login();

    const created = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });

    const read = await request<ErrorBody>('GET', `/conversations/${created.body.data.id}`, {
      token: stranger.token,
    });
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('NOT_FOUND');

    const reported = await request<ErrorBody>(
      'POST',
      `/conversations/${created.body.data.id}/report`,
      { token: stranger.token, body: { reasonCode: 'OTHER' } },
    );
    expect(reported.status).toBe(404);

    // Unknown and malformed ids are not found either.
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const response = await request<ErrorBody>('GET', `/conversations/${id}`, {
        token: alice.token,
      });
      expect(response.status, id).toBe(404);
    }
  });

  it('rejects an invalid report payload', async () => {
    const alice = await login();
    const bob = await login();
    const created = await request<ConversationBody>('POST', '/conversations', {
      token: alice.token,
      body: { peerUserId: bob.userId },
    });

    for (const body of [
      {},
      { reasonCode: 'BECAUSE' },
      { reasonCode: 'HARASSMENT', description: 'x'.repeat(2001) },
      { reasonCode: 'HARASSMENT', status: 'RESOLVED' },
    ]) {
      const response = await request<ErrorBody>(
        'POST',
        `/conversations/${created.body.data.id}/report`,
        { token: alice.token, body },
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
