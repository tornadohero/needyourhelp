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
import { BlockService } from '../../src/modules/messaging/application/block.service';
import { ConversationService } from '../../src/modules/messaging/application/conversation.service';
import { BLOCK_REPOSITORY } from '../../src/modules/messaging/domain/block.repository';
import { CONVERSATION_REPOSITORY } from '../../src/modules/messaging/domain/conversation.repository';
import { MESSAGING_GATEWAY } from '../../src/modules/messaging/domain/messaging-gateway';
import { BlockController } from '../../src/modules/messaging/http/block.controller';
import { ConversationController } from '../../src/modules/messaging/http/conversation.controller';
import { MockMessagingGateway } from '../../src/modules/messaging/infrastructure/mock-messaging.gateway';
import { PrismaBlockRepository } from '../../src/modules/messaging/infrastructure/prisma-block.repository';
import { PrismaConversationRepository } from '../../src/modules/messaging/infrastructure/prisma-conversation.repository';
import { AUDIT_LOG_REPOSITORY } from '../../src/modules/audit/domain/audit-log.repository';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/prisma-audit-log.repository';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/user.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { PROVIDER_DIRECTORY } from '../../src/modules/discovery/domain/provider-directory';
import { PrismaProviderDirectory } from '../../src/modules/discovery/infrastructure/prisma-provider.directory';
import { FEATURE_FLAG_REPOSITORY } from '../../src/modules/platform/domain/feature-flag.repository';
import { PrismaFeatureFlagRepository } from '../../src/modules/platform/infrastructure/prisma-feature-flag.repository';
import { MODERATION_REPOSITORY } from '../../src/modules/moderation/domain/moderation.repository';
import { PrismaModerationRepository } from '../../src/modules/moderation/infrastructure/prisma-moderation.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Sending and reading messages over HTTP (T028 gap G4).
 *
 * The chat screens had no way to exchange a message: conversations existed, but
 * only server-generated system messages could be sent. This covers the real
 * route end to end with the mock transport, including the gates a client must
 * not be able to walk around: membership and blocks.
 */
describeWithDatabase('conversation messages HTTP', () => {
  const prisma: PrismaService = createTestPrismaService();
  let app: INestApplication;
  let baseUrl: string;
  const userIds: string[] = [];
  const conversationIds: string[] = [];

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
        { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
        { provide: BLOCK_REPOSITORY, useClass: PrismaBlockRepository },
        { provide: MODERATION_REPOSITORY, useClass: PrismaModerationRepository },
        { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
        { provide: PROVIDER_DIRECTORY, useClass: PrismaProviderDirectory },
        { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
        { provide: MESSAGING_GATEWAY, useValue: new MockMessagingGateway({ environment: 'test' }) },
        {
          provide: ACCESS_TOKEN_SERVICE,
          useValue: new JwtAccessTokenService({
            secret: 'messages-e2e-secret',
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
            openidPepper: 'messages-e2e-pepper',
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
    await prisma.messageReference.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await prisma.block.deleteMany({
      where: { blockerUserId: { in: userIds }, blockedUserId: { in: userIds } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function account(code: string): Promise<{ userId: string; token: string }> {
    const response = await fetch(`${baseUrl}/auth/wechat/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = (await response.json()) as {
      data: { accessToken: string; user: { id: string } };
    };
    userIds.push(body.data.user.id);
    return { userId: body.data.user.id, token: body.data.accessToken };
  }

  function call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  it('exchanges messages inside a conversation, and only between its members', async () => {
    const a = await account('messages-http-a');
    const b = await account('messages-http-b');
    const stranger = await account('messages-http-stranger');

    const created = await call('POST', '/conversations', {
      token: a.token,
      body: { peerUserId: b.userId },
    });
    expect(created.status).toBe(201);
    const conversationId = ((await created.json()) as { data: { id: string } }).data.id;
    conversationIds.push(conversationId);

    // Unauthenticated: no message without a session.
    expect(
      (await call('POST', `/conversations/${conversationId}/messages`, { body: { body: '你好' } }))
        .status,
    ).toBe(401);

    // A non-member gets NOT_FOUND: a conversation id cannot be probed.
    expect(
      (
        await call('POST', `/conversations/${conversationId}/messages`, {
          token: stranger.token,
          body: { body: '有人在吗' },
        })
      ).status,
    ).toBe(404);

    const sent = await call('POST', `/conversations/${conversationId}/messages`, {
      token: a.token,
      body: { body: '你好，请问周六有空吗？' },
    });
    expect(sent.status).toBe(201);
    const message = (await sent.json()) as {
      data: { id: string; senderUserId: string; body: string; moderationStatus: string };
    };
    expect(message.data).toMatchObject({
      senderUserId: a.userId,
      body: '你好，请问周六有空吗？',
      moderationStatus: 'PENDING',
    });

    // Both members can read the thread.
    for (const token of [a.token, b.token]) {
      const thread = await call('GET', `/conversations/${conversationId}/messages?limit=10`, {
        token,
      });
      expect(thread.status).toBe(200);
      const items = ((await thread.json()) as { data: { items: unknown[] } }).data.items;
      expect(items).toHaveLength(1);
    }

    // The platform persisted a reference, and no content with it.
    const references = await prisma.messageReference.findMany({ where: { conversationId } });
    expect(references).toHaveLength(1);
    expect(references[0]?.externalMessageId).toBeTruthy();
    expect(JSON.stringify(references)).not.toContain('周六');

    // An empty message and an unknown field are refused.
    expect(
      (
        await call('POST', `/conversations/${conversationId}/messages`, {
          token: a.token,
          body: { body: '   ' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/conversations/${conversationId}/messages`, {
          token: a.token,
          body: { body: '你好', senderUserId: b.userId },
        })
      ).status,
    ).toBe(400);
  });

  it('stops delivery once either side blocks', async () => {
    const a = await account('messages-http-blocker');
    const b = await account('messages-http-blocked');

    const created = await call('POST', '/conversations', {
      token: a.token,
      body: { peerUserId: b.userId },
    });
    const conversationId = ((await created.json()) as { data: { id: string } }).data.id;
    conversationIds.push(conversationId);

    await call('POST', `/conversations/${conversationId}/messages`, {
      token: a.token,
      body: { body: '第一条' },
    });

    // `b` blocks `a`: neither direction may deliver any more.
    const blocked = await call('POST', `/users/${a.userId}/block`, { token: b.token });
    expect(blocked.status).toBe(201);

    const afterBlock = await call('POST', `/conversations/${conversationId}/messages`, {
      token: a.token,
      body: { body: '还能收到吗' },
    });
    // A block freezes the conversation, so delivery is refused by the state
    // machine before anything reaches the transport.
    expect(afterBlock.status).toBe(400);
    expect(((await afterBlock.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(await prisma.messageReference.count({ where: { conversationId } })).toBe(1);

    // Reading still works: the block stops delivery, it does not erase history.
    const thread = await call('GET', `/conversations/${conversationId}/messages`, {
      token: b.token,
    });
    expect(thread.status).toBe(200);
  });
});
