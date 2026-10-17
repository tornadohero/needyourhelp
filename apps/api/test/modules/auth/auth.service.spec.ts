import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../src/common/security/hash';
import type { AuthServiceConfig } from '../../../src/modules/auth/domain/auth.service';
import { AuthService } from '../../../src/modules/auth/domain/auth.service';
import { MockProviderNotAllowedError } from '../../../src/modules/auth/domain/auth-errors';
import { hmacHex } from '../../../src/common/security/hash';
import {
  FakeAccessTokenService,
  FakeSessionRepository,
  FakeUserRepository,
  FakeWeChatAuthProvider,
} from './fakes';

const PEPPER = 'unit-test-pepper';

const config: AuthServiceConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 60 * 60 * 24,
  openidPepper: PEPPER,
  defaultRoles: ['USER'],
};

function build(wechat = new FakeWeChatAuthProvider()) {
  const users = new FakeUserRepository();
  const sessions = new FakeSessionRepository();
  const accessTokens = new FakeAccessTokenService();
  const service = new AuthService(users, sessions, accessTokens, wechat, config);
  return { service, users, sessions, accessTokens };
}

describe('AuthService', () => {
  it('creates the account on first login with server-decided roles only', async () => {
    const { service, users } = build();

    const result = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    expect(result.user.roles).toEqual(['USER']);
    expect(result.session.accessToken).toBeTruthy();
    expect(result.session.refreshToken).toBeTruthy();

    const stored = await users.findByWechatOpenidHash(hmacHex('openid:wx-code-1', PEPPER));
    expect(stored?.id).toBe(result.user.id);
    // The raw openid is never stored: only the keyed hash.
    expect(stored?.wechatOpenidHash).not.toContain('openid:wx-code-1');
  });

  it('reuses the same account for the same WeChat identity and never escalates roles', async () => {
    const { service, users } = build();

    const first = await service.loginWithWeChatCode({ code: 'wx-code-1' });
    await users.addRole(first.user.id, 'PARENT');

    const second = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.roles.sort()).toEqual(['PARENT', 'USER']);
  });

  it('rejects an empty login code', async () => {
    const { service } = build();
    await expect(service.loginWithWeChatCode({ code: '   ' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('maps an upstream failure to AUTH_REQUIRED without leaking provider details', async () => {
    const { service } = build(
      new FakeWeChatAuthProvider({ failWith: new Error('upstream 40029 invalid code') }),
    );

    await expect(service.loginWithWeChatCode({ code: 'bad' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'WeChat login code is not valid.',
    });
  });

  it('refuses mock login outside isolated environments', async () => {
    const { service } = build(new FakeWeChatAuthProvider({ production: true }));

    await expect(service.loginWithWeChatCode({ code: 'wx-code-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses a suspended or deleted account', async () => {
    const { service, users } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    await users.setStatus(login.user.id, 'SUSPENDED');
    await expect(service.loginWithWeChatCode({ code: 'wx-code-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await users.setStatus(login.user.id, 'ACTIVE');
    users.markDeleted(login.user.id);
    await expect(service.loginWithWeChatCode({ code: 'wx-code-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rotates the refresh token and revokes the previous session', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    const rotated = await service.refresh({ refreshToken: login.session.refreshToken });

    expect(rotated.session.id).not.toBe(login.session.session.id);
    expect(rotated.session.rotatedFromSessionId).toBe(login.session.session.id);

    const previous = await sessions.findById(login.session.session.id);
    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.revokedReason).toBe('ROTATED');
  });

  it('invalidates the old refresh token after rotation', async () => {
    const { service } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });
    await service.refresh({ refreshToken: login.session.refreshToken });

    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('revokes the whole rotation chain when a rotated token is replayed', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });
    const second = await service.refresh({ refreshToken: login.session.refreshToken });
    const third = await service.refresh({ refreshToken: second.refreshToken });

    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    for (const session of [second, third]) {
      const stored = await sessions.findById(session.session.id);
      expect(stored?.revokedAt, `session ${session.session.id} must be revoked`).not.toBeNull();
    }
    // The still-live session is revoked with the replay reason.
    expect((await sessions.findById(third.session.id))?.revokedReason).toBe('REPLAY_DETECTED');

    // The newest token must no longer work either.
    await expect(service.refresh({ refreshToken: third.refreshToken })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('rejects an unknown refresh token', async () => {
    const { service } = build();
    await expect(service.refresh({ refreshToken: 'not-a-token' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('expires a session when the refresh token is used after its lifetime', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    const session = await sessions.findById(login.session.session.id);
    if (session) {
      sessions.sessions.set(session.id, { ...session, expiresAt: new Date(Date.now() - 1000) });
    }

    await expect(
      service.refresh({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect((await sessions.findById(login.session.session.id))?.revokedReason).toBe('EXPIRED');
  });

  it('logs out by refresh token and rejects a replayed logout', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    await service.logout({ refreshToken: login.session.refreshToken });
    expect((await sessions.findById(login.session.session.id))?.revokedReason).toBe('LOGOUT');

    await expect(
      service.logout({ refreshToken: login.session.refreshToken }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('logs out by access token (principal)', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });
    const principal = await service.authenticateAccessToken(login.session.accessToken);

    await service.logout({ principal });

    expect((await sessions.findById(principal.sessionId))?.revokedReason).toBe('LOGOUT');
    await expect(service.authenticateAccessToken(login.session.accessToken)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('authenticates a valid access token and rejects a revoked session', async () => {
    const { service } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    const principal = await service.authenticateAccessToken(login.session.accessToken);
    expect(principal.userId).toBe(login.user.id);
    expect(principal.roles).toEqual(['USER']);

    await service.logout({ refreshToken: login.session.refreshToken });
    await expect(service.authenticateAccessToken(login.session.accessToken)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('never stores the raw refresh token', async () => {
    const { service, sessions } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });

    const stored = await sessions.findByRefreshTokenHash(sha256Hex(login.session.refreshToken));
    expect(stored).not.toBeNull();
    for (const session of sessions.sessions.values()) {
      expect(session.refreshTokenHash).not.toBe(login.session.refreshToken);
    }
  });

  it('returns an allowlist for GET /me', async () => {
    const { service } = build();
    const login = await service.loginWithWeChatCode({ code: 'wx-code-1' });
    const principal = await service.authenticateAccessToken(login.session.accessToken);

    const me = await service.describePrincipal(principal);

    expect(Object.keys(me).sort()).toEqual(
      ['avatarUrl', 'displayName', 'id', 'roles', 'status'].sort(),
    );
    expect(me.roles).toEqual(['USER']);
  });
});

describe('AuthService mock guard', () => {
  it('never allows the mock adapter error to surface as anything but FORBIDDEN', async () => {
    const { service } = build(new FakeWeChatAuthProvider({ production: true }));
    const error = await service
      .loginWithWeChatCode({ code: 'x' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('FORBIDDEN');
    expect(new MockProviderNotAllowedError()).toBeInstanceOf(Error);
  });
});
