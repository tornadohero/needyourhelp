import { randomUUID } from 'node:crypto';

import type { ApiRole } from '@mentor/api-contracts';
import { Inject, Injectable } from '@nestjs/common';

import { hmacHex, randomSecret, sha256Hex, shortFingerprint } from '../../../common/security/hash';
import type { UserRepository } from '../../identity/domain/user.repository';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { AccessTokenService } from './access-token.service';
import { ACCESS_TOKEN_SERVICE } from './access-token.service';
import {
  authForbidden,
  invalidCredentials,
  MockProviderNotAllowedError,
  WeChatProviderUnavailableError,
} from './auth-errors';
import type { ConsoleCredentialRepository } from './console-credential.repository';
import { CONSOLE_CREDENTIAL_REPOSITORY } from './console-credential.repository';
import { CONSOLE_ROLES, hasAnyRole, isLocked, lockoutFor } from './console-credential-policy';
import type { ConsolePasswordHasher } from './password-hasher';
import { CONSOLE_PASSWORD_HASHER } from './password-hasher';
import type { AuthPrincipal, IssuedSession } from './auth-session.model';
import { DEFAULT_ROLE, SESSION_REVOKED_REASON } from './auth-session.model';
import type { SessionRepository } from './session.repository';
import { SESSION_REPOSITORY } from './session.repository';
import type { WeChatAuthProvider } from './wechat-auth.provider';
import { WECHAT_AUTH_PROVIDER } from './wechat-auth.provider';

/** DI token for {@link AuthServiceConfig}. */
export const AUTH_CONFIG = 'AUTH_CONFIG';

/** DI token for {@link AuthService} (aliases the class token). */
export const AUTH_SERVICE = 'AUTH_SERVICE';

export interface AuthServiceConfig {
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  openidPepper: string;
  /** Roles granted to a brand new account. Never taken from the client. */
  defaultRoles: ApiRole[];
}

export interface LoginInput {
  code: string;
  deviceLabel?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

/** Everything a session needs to know about the caller, whatever the login path. */
export interface SessionContext {
  deviceLabel?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

/** `POST /auth/console/login` (T028 gap G1: the admin web). */
export interface ConsoleLoginInput extends SessionContext {
  username: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
  deviceLabel?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

export interface LogoutInput {
  refreshToken?: string | null;
  principal?: AuthPrincipal | null;
}

/**
 * Authentication application service.
 *
 * Invariants enforced here (`AGENTS.md` §7, §9):
 * - roles are assigned server-side only; a client can never request one;
 * - the authenticated user id always comes from the token/session, never from
 *   the request body;
 * - refresh tokens rotate on every use and are stored only as hashes;
 * - a replayed refresh token revokes the whole rotation chain.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokens: AccessTokenService,
    @Inject(WECHAT_AUTH_PROVIDER) private readonly wechat: WeChatAuthProvider,
    @Inject(AUTH_CONFIG) private readonly config: AuthServiceConfig,
    @Inject(CONSOLE_CREDENTIAL_REPOSITORY)
    private readonly consoleCredentials: ConsoleCredentialRepository,
    @Inject(CONSOLE_PASSWORD_HASHER) private readonly passwords: ConsolePasswordHasher,
  ) {}

  /**
   * `POST /auth/console/login`: username/password for the **admin web**
   * (T028 gap G1).
   *
   * The credential only proves an operator identity — it never grants one: the
   * account must already hold `ADMIN` or `OPS`, checked server-side. A wrong
   * password, a missing credential and a non-operator account all answer with
   * the same "not valid" so the endpoint cannot be used to enumerate operators.
   */
  async loginWithConsoleCredential(input: ConsoleLoginInput): Promise<{
    session: IssuedSession;
    user: { id: string; displayName: string; avatarUrl: string | null; roles: ApiRole[] };
  }> {
    const credential = await this.consoleCredentials.findByUsername(
      input.username.trim().toLowerCase(),
    );

    if (!credential) {
      throw invalidCredentials('Console credentials are not valid.');
    }
    if (isLocked(credential.lockedUntil)) {
      throw authForbidden('This console credential is temporarily locked.');
    }

    const valid = await this.passwords.verify(input.password, credential.passwordHash);
    if (!valid) {
      const failedAttempts = credential.failedAttempts + 1;
      const lockedUntil = lockoutFor(failedAttempts);
      await this.consoleCredentials.recordFailure({
        id: credential.id,
        failedAttempts,
        lockedUntil,
      });
      throw invalidCredentials('Console credentials are not valid.');
    }

    const user = await this.users.findById(credential.userId);
    if (!user) {
      throw invalidCredentials('Console credentials are not valid.');
    }
    this.assertUsable(user.status, user.deletedAt);

    const roles = await this.users.listRoles(user.id);
    // Login never grants power: an operator who lost the role loses the console.
    if (!hasAnyRole(roles, CONSOLE_ROLES)) {
      throw authForbidden('This account may not use the admin console.');
    }

    const session = await this.issueSession(user.id, input);
    await this.consoleCredentials.recordSuccess(credential.id);

    return {
      session,
      user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, roles },
    };
  }

  /** `POST /auth/wechat/login`. */
  async loginWithWeChatCode(input: LoginInput): Promise<{
    session: IssuedSession;
    user: { id: string; displayName: string; avatarUrl: string | null; roles: ApiRole[] };
  }> {
    const identity = await this.exchangeCode(input.code);

    const openidHash = hmacHex(identity.openid, this.config.openidPepper);
    const unionidHash = identity.unionid
      ? hmacHex(identity.unionid, this.config.openidPepper)
      : null;

    let user = await this.users.findByWechatOpenidHash(openidHash);
    if (!user) {
      // Display name is derived, never supplied by the client: a WeChat
      // `code2Session` exchange returns no profile data.
      user = await this.users.createWithRoles(
        {
          wechatOpenidHash: openidHash,
          unionidHash,
          displayName: `微信用户${shortFingerprint(openidHash)}`,
        },
        this.config.defaultRoles,
      );
    }

    this.assertUsable(user.status, user.deletedAt);

    const session = await this.issueSession(user.id, input);
    const roles = await this.users.listRoles(user.id);

    return {
      session,
      user: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, roles },
    };
  }

  /** `POST /auth/refresh`: rotate the refresh token and issue a new pair. */
  async refresh(input: RefreshInput): Promise<IssuedSession> {
    const refreshTokenHash = sha256Hex(input.refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(refreshTokenHash);
    if (!session) {
      throw invalidCredentials('Refresh token is not valid.');
    }

    if (session.revokedAt) {
      // Replay of a rotated/revoked token: contain the whole chain.
      await this.sessions.revokeChain(session.id, SESSION_REVOKED_REASON.replayDetected);
      throw invalidCredentials('Refresh token is not valid.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.revoke(session.id, SESSION_REVOKED_REASON.expired);
      throw invalidCredentials('Session has expired.');
    }

    const user = await this.users.findById(session.userId);
    if (!user) {
      throw invalidCredentials('Refresh token is not valid.');
    }
    this.assertUsable(user.status, user.deletedAt);

    // Mint the raw refresh token first: only its hash is persisted.
    const refreshToken = randomSecret();
    const rotated = await this.sessions.rotate({
      sessionId: session.id,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
      reason: SESSION_REVOKED_REASON.rotated,
    });

    const accessToken = await this.accessTokens.issue({
      userId: user.id,
      sessionId: rotated.id,
      jti: randomUUID(),
      expiresAt: new Date(Date.now() + this.config.accessTokenTtlSeconds * 1000),
    });
    await this.sessions.setAccessTokenJti(rotated.id, accessToken.jti);

    return {
      session: { ...rotated, accessTokenJti: accessToken.jti },
      accessToken: accessToken.token,
      refreshToken,
      expiresIn: accessToken.expiresIn,
    };
  }

  /** `POST /auth/logout`: revoke the presented session(s). */
  async logout(input: LogoutInput): Promise<void> {
    let revoked = false;

    if (input.refreshToken) {
      const session = await this.sessions.findByRefreshTokenHash(sha256Hex(input.refreshToken));
      if (session && !session.revokedAt) {
        await this.sessions.revoke(session.id, SESSION_REVOKED_REASON.logout);
        revoked = true;
      }
    }

    if (input.principal && !(input.refreshToken && revoked)) {
      await this.sessions.revoke(input.principal.sessionId, SESSION_REVOKED_REASON.logout);
      revoked = true;
    }

    if (!revoked) {
      // Do not disclose whether a credential existed.
      throw invalidCredentials('No active session to revoke.');
    }
  }

  /** Resolve the subject of a valid access token (used by `JwtAuthGuard`). */
  async authenticateAccessToken(token: string): Promise<AuthPrincipal> {
    const claims = await this.accessTokens.verify(token);

    const session = await this.sessions.findById(claims.sessionId);
    if (!session || session.revokedAt || session.userId !== claims.userId) {
      throw invalidCredentials('Session is no longer valid.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.revoke(session.id, SESSION_REVOKED_REASON.expired);
      throw invalidCredentials('Session has expired.');
    }

    const user = await this.users.findById(claims.userId);
    if (!user) {
      throw invalidCredentials('Session is no longer valid.');
    }
    this.assertUsable(user.status, user.deletedAt);

    const roles = await this.users.listRoles(user.id);

    return {
      userId: user.id,
      sessionId: session.id,
      accessTokenJti: claims.jti,
      roles,
      status: user.status,
    };
  }

  /** `GET /me` payload: an allowlist built from server-side state. */
  async describePrincipal(principal: AuthPrincipal): Promise<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    status: 'ACTIVE' | 'SUSPENDED';
    roles: ApiRole[];
  }> {
    const user = await this.users.findById(principal.userId);
    if (!user) {
      throw invalidCredentials('Session is no longer valid.');
    }
    const roles = await this.users.listRoles(user.id);

    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      roles,
    };
  }

  private async exchangeCode(code: string): Promise<{ openid: string; unionid: string | null }> {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw invalidCredentials('WeChat login code is required.');
    }

    try {
      return await this.wechat.exchangeCode({ code });
    } catch (error) {
      if (error instanceof MockProviderNotAllowedError) {
        throw authForbidden(error.message);
      }
      if (error instanceof WeChatProviderUnavailableError) {
        // Never leak provider internals to the client.
        throw invalidCredentials('WeChat login is temporarily unavailable.');
      }
      // Anything else (invalid code, upstream rejection) is a credential failure.
      throw invalidCredentials('WeChat login code is not valid.');
    }
  }

  private assertUsable(status: string, deletedAt: Date | null): void {
    if (deletedAt) {
      throw authForbidden('Account is not available.');
    }
    if (status !== 'ACTIVE') {
      throw authForbidden('Account is suspended.');
    }
  }

  private async issueSession(userId: string, input: SessionContext): Promise<IssuedSession> {
    const refreshToken = randomSecret();
    const session = await this.sessions.create({
      userId,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
      deviceLabel: input.deviceLabel ?? null,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
    });

    const accessToken = await this.accessTokens.issue({
      userId,
      sessionId: session.id,
      jti: randomUUID(),
      expiresAt: new Date(Date.now() + this.config.accessTokenTtlSeconds * 1000),
    });
    await this.sessions.setAccessTokenJti(session.id, accessToken.jti);

    return {
      session: { ...session, accessTokenJti: accessToken.jti },
      accessToken: accessToken.token,
      refreshToken,
      expiresIn: accessToken.expiresIn,
    };
  }
}

/** Injection tokens re-exported for the module wiring. */
export const AUTH_DEPENDENCIES = {
  users: USER_REPOSITORY,
  sessions: SESSION_REPOSITORY,
  accessTokens: ACCESS_TOKEN_SERVICE,
  wechat: WECHAT_AUTH_PROVIDER,
};

export { DEFAULT_ROLE };
