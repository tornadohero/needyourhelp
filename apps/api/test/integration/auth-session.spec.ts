import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { sha256Hex } from '../../src/common/security/hash';
import type { AuthServiceConfig } from '../../src/modules/auth/domain/auth.service';
import { AuthService } from '../../src/modules/auth/domain/auth.service';
import { JwtAccessTokenService } from '../../src/modules/auth/infrastructure/jwt-access-token.service';
import { MockWeChatAuthProvider } from '../../src/modules/auth/infrastructure/mock-wechat-auth.provider';
import { PrismaSessionRepository } from '../../src/modules/auth/infrastructure/prisma-session.repository';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/prisma-user.repository';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Session lifecycle against a real PostgreSQL database
 * (`specs/04-database-spec.md` §sessions):
 * creation, hashing, rotation, replay containment, expiry and logout.
 */
describeWithDatabase('auth sessions (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  const config: AuthServiceConfig = {
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 86_400,
    openidPepper: 'integration-pepper',
    defaultRoles: ['USER'],
  };

  let service: AuthService;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    service = new AuthService(
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new JwtAccessTokenService({
        secret: 'integration-access-secret',
        ttlSeconds: 900,
        issuer: 'mentor-platform',
      }),
      new MockWeChatAuthProvider({ environment: 'test' }),
      config,
    );
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('creates a user and a session on first login, storing only hashes', async () => {
    const login = await service.loginWithWeChatCode({
      code: 'integration-code-1',
      ipHash: sha256Hex('127.0.0.1'),
      userAgentHash: sha256Hex('vitest'),
    });
    userIds.push(login.user.id);

    expect(login.user.roles).toEqual(['USER']);

    const row = await prisma.session.findUnique({ where: { id: login.session.session.id } });
    expect(row).not.toBeNull();
    expect(row?.refreshTokenHash).toBe(sha256Hex(login.session.refreshToken));
    expect(row?.refreshTokenHash).not.toBe(login.session.refreshToken);
    expect(row?.ipHash).toBe(sha256Hex('127.0.0.1'));
    expect(row?.accessTokenJti).toBeTruthy();

    // The raw openid never reaches the database.
    const user = await prisma.user.findUnique({ where: { id: login.user.id } });
    expect(user?.wechatOpenidHash).not.toContain('integration-code-1');
  });

  it('never escalates roles on repeated logins', async () => {
    const first = await service.loginWithWeChatCode({ code: 'integration-code-2' });
    userIds.push(first.user.id);

    const second = await service.loginWithWeChatCode({ code: 'integration-code-2' });

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.roles).toEqual(['USER']);
    expect(await prisma.userRole.count({ where: { userId: first.user.id } })).toBe(1);
  });

  it('rotates refresh tokens and marks the previous session rotated', async () => {
    const login = await service.loginWithWeChatCode({ code: 'integration-code-3' });
    userIds.push(login.user.id);

    const rotated = await service.refresh({ refreshToken: login.session.refreshToken });

    const previous = await prisma.session.findUnique({ where: { id: login.session.session.id } });
    const current = await prisma.session.findUnique({ where: { id: rotated.session.id } });

    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.revokedReason).toBe('ROTATED');
    expect(current?.rotatedFromSessionId).toBe(login.session.session.id);
    expect(current?.revokedAt).toBeNull();
  });

  it('revokes the rotation chain when a rotated refresh token is replayed', async () => {
    const login = await service.loginWithWeChatCode({ code: 'integration-code-4' });
    userIds.push(login.user.id);

    const second = await service.refresh({ refreshToken: login.session.refreshToken });
    const third = await service.refresh({ refreshToken: second.refreshToken });

    await expect(service.refresh({ refreshToken: second.refreshToken })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });

    for (const sessionId of [second.session.id, third.session.id]) {
      const row = await prisma.session.findUnique({ where: { id: sessionId } });
      expect(row?.revokedAt, `session ${sessionId} must be revoked`).not.toBeNull();
    }
    // The still-live session carries the replay reason.
    const newest = await prisma.session.findUnique({ where: { id: third.session.id } });
    expect(newest?.revokedReason).toBe('REPLAY_DETECTED');
  });

  it('rejects and expires a session used after its lifetime', async () => {
    const login = await service.loginWithWeChatCode({ code: 'integration-code-5' });
    userIds.push(login.user.id);

    await prisma.session.update({
      where: { id: login.session.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    const row = await prisma.session.findUnique({ where: { id: login.session.session.id } });
    expect(row?.revokedReason).toBe('EXPIRED');
  });

  it('logs out by refresh token and invalidates the access token', async () => {
    const login = await service.loginWithWeChatCode({ code: 'integration-code-6' });
    userIds.push(login.user.id);

    await service.logout({ refreshToken: login.session.refreshToken });

    const row = await prisma.session.findUnique({ where: { id: login.session.session.id } });
    expect(row?.revokedReason).toBe('LOGOUT');

    await expect(service.authenticateAccessToken(login.session.accessToken)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('refuses a suspended account on refresh', async () => {
    const login = await service.loginWithWeChatCode({ code: 'integration-code-7' });
    userIds.push(login.user.id);

    await prisma.user.update({ where: { id: login.user.id }, data: { status: 'SUSPENDED' } });

    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.authenticateAccessToken(login.session.accessToken)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
