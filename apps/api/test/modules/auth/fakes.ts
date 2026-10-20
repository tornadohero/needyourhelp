import type { ApiRole } from '@mentor/api-contracts';

import type {
  AuthSession,
  CreateSessionInput,
  SessionRevokedReason,
} from '../../../src/modules/auth/domain/auth-session.model';
import type { SessionRepository } from '../../../src/modules/auth/domain/session.repository';
import type { User, UserStatus } from '../../../src/modules/identity/domain/user.model';
import type { UserRepository } from '../../../src/modules/identity/domain/user.repository';
import type {
  AccessTokenClaims,
  AccessTokenService,
  IssuedAccessToken,
} from '../../../src/modules/auth/domain/access-token.service';
import type {
  WeChatAuthProvider,
  WeChatCodeExchangeInput,
  WeChatIdentity,
} from '../../../src/modules/auth/domain/wechat-auth.provider';
import { MockProviderNotAllowedError } from '../../../src/modules/auth/domain/auth-errors';
import { randomSecret } from '../../../src/common/security/hash';
import type {
  ConsoleCredentialRecord,
  ConsoleCredentialRepository,
} from '../../../src/modules/auth/domain/console-credential.repository';
import type { ConsolePasswordHasher } from '../../../src/modules/auth/domain/password-hasher';
import { constantTimeEqual, sha256Hex } from '../../../src/common/security/hash';

let sequence = 0;

export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** In-memory {@link UserRepository}. */
export class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  readonly roles = new Map<string, Set<ApiRole>>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByWechatOpenidHash(openidHash: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.wechatOpenidHash === openidHash) {
        return user;
      }
    }
    return null;
  }

  async create(input: { displayName: string; wechatOpenidHash?: string | null }): Promise<User> {
    return this.createWithRoles(input, []);
  }

  async createWithRoles(
    input: {
      displayName: string;
      wechatOpenidHash?: string | null;
      unionidHash?: string | null;
      avatarUrl?: string | null;
    },
    roles: ApiRole[],
  ): Promise<User> {
    const now = new Date();
    const user: User = {
      id: nextId('user'),
      status: 'ACTIVE',
      wechatOpenidHash: input.wechatOpenidHash ?? null,
      unionidHash: input.unionidHash ?? null,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.users.set(user.id, user);
    this.roles.set(user.id, new Set(roles));
    return user;
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; avatarUrl?: string | null },
  ): Promise<User> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('user not found');
    }
    const updated: User = {
      ...user,
      displayName: input.displayName ?? user.displayName,
      avatarUrl: input.avatarUrl === undefined ? user.avatarUrl : input.avatarUrl,
    };
    this.users.set(userId, updated);
    return updated;
  }

  async addRole(userId: string, role: ApiRole): Promise<void> {
    const current = this.roles.get(userId) ?? new Set<ApiRole>();
    current.add(role);
    this.roles.set(userId, current);
  }

  async removeRole(userId: string, role: ApiRole): Promise<void> {
    this.roles.get(userId)?.delete(role);
  }

  async listRoles(userId: string): Promise<ApiRole[]> {
    return [...(this.roles.get(userId) ?? new Set<ApiRole>())];
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      this.users.set(userId, { ...user, status });
    }
  }

  /** Test helper: simulate a deleted account. */
  markDeleted(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      this.users.set(userId, { ...user, deletedAt: new Date() });
    }
  }
}

/** In-memory {@link SessionRepository} with rotation and chain revocation. */
export class FakeSessionRepository implements SessionRepository {
  readonly sessions = new Map<string, AuthSession>();

  async create(input: CreateSessionInput): Promise<AuthSession> {
    const session: AuthSession = {
      id: nextId('session'),
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      accessTokenJti: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedReason: null,
      rotatedFromSessionId: null,
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findById(id: string): Promise<AuthSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async findByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSession | null> {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === refreshTokenHash) {
        return session;
      }
    }
    return null;
  }

  async rotate(input: {
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    reason: SessionRevokedReason;
  }): Promise<AuthSession> {
    const current = this.sessions.get(input.sessionId);
    if (!current) {
      throw new Error('session not found');
    }
    const created: AuthSession = {
      ...current,
      id: nextId('session'),
      refreshTokenHash: input.refreshTokenHash,
      accessTokenJti: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedReason: null,
      rotatedFromSessionId: current.id,
      createdAt: new Date(),
    };
    this.sessions.set(created.id, created);
    this.sessions.set(current.id, {
      ...current,
      revokedAt: new Date(),
      revokedReason: input.reason,
    });
    return created;
  }

  async revoke(sessionId: string, reason: SessionRevokedReason): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && !session.revokedAt) {
      this.sessions.set(sessionId, { ...session, revokedAt: new Date(), revokedReason: reason });
    }
  }

  async revokeChain(rootSessionId: string, reason: SessionRevokedReason): Promise<string[]> {
    const revoked: string[] = [];
    const queue = [rootSessionId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) {
        continue;
      }
      const session = this.sessions.get(id);
      if (!session) {
        continue;
      }
      if (!session.revokedAt) {
        this.sessions.set(id, { ...session, revokedAt: new Date(), revokedReason: reason });
      }
      revoked.push(id);
      for (const candidate of this.sessions.values()) {
        if (candidate.rotatedFromSessionId === id) {
          queue.push(candidate.id);
        }
      }
    }
    return revoked;
  }

  async setAccessTokenJti(sessionId: string, jti: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, accessTokenJti: jti });
    }
  }
}

/** Deterministic stand-in for JWT signing/verification. */
export class FakeAccessTokenService implements AccessTokenService {
  readonly claimsByToken = new Map<string, AccessTokenClaims>();

  async issue(input: AccessTokenClaims): Promise<IssuedAccessToken> {
    const token = `access:${input.jti}`;
    this.claimsByToken.set(token, input);
    return {
      token,
      jti: input.jti,
      expiresAt: input.expiresAt,
      expiresIn: Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const claims = this.claimsByToken.get(token);
    if (!claims) {
      throw new Error('invalid token');
    }
    return claims;
  }
}

/** WeChat adapter stand-in: `code` -> stable openid. */
export class FakeWeChatAuthProvider implements WeChatAuthProvider {
  readonly name = 'fake';

  constructor(private readonly options: { failWith?: unknown; production?: boolean } = {}) {}

  async exchangeCode(input: WeChatCodeExchangeInput): Promise<WeChatIdentity> {
    if (this.options.production) {
      throw new MockProviderNotAllowedError();
    }
    if (this.options.failWith) {
      throw this.options.failWith;
    }
    return { openid: `openid:${input.code}`, unionid: null };
  }

  /** Test helper: mint a raw refresh token the way the service does. */
  static refreshToken(): string {
    return randomSecret();
  }
}

/**
 * In-memory {@link ConsoleCredentialRepository} (T028 gap G1).
 *
 * Mirrors the real adapter: one credential per account, failures counted, a lock
 * that can be stored and cleared.
 */
export class FakeConsoleCredentialRepository implements ConsoleCredentialRepository {
  readonly credentials = new Map<string, ConsoleCredentialRecord>();
  private sequence = 0;

  async findByUsername(username: string): Promise<ConsoleCredentialRecord | null> {
    return (
      [...this.credentials.values()].find((row) => row.username === username.toLowerCase()) ?? null
    );
  }

  async findByUserId(userId: string): Promise<ConsoleCredentialRecord | null> {
    return [...this.credentials.values()].find((row) => row.userId === userId) ?? null;
  }

  async upsert(input: {
    userId: string;
    username: string;
    passwordHash: string;
  }): Promise<ConsoleCredentialRecord> {
    const existing = await this.findByUserId(input.userId);
    const record: ConsoleCredentialRecord = existing
      ? { ...existing, username: input.username.toLowerCase(), passwordHash: input.passwordHash }
      : {
          id: `console-${++this.sequence}`,
          userId: input.userId,
          username: input.username.toLowerCase(),
          passwordHash: input.passwordHash,
          failedAttempts: 0,
          lockedUntil: null,
          lastUsedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
    this.credentials.set(record.id, record);
    return record;
  }

  async deleteByUserId(userId: string): Promise<void> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      this.credentials.delete(existing.id);
    }
  }

  async recordFailure(input: {
    id: string;
    failedAttempts: number;
    lockedUntil: Date | null;
  }): Promise<ConsoleCredentialRecord> {
    const current = this.credentials.get(input.id);
    if (!current) {
      throw new Error(`unknown credential ${input.id}`);
    }
    const updated: ConsoleCredentialRecord = {
      ...current,
      failedAttempts: input.failedAttempts,
      lockedUntil: input.lockedUntil,
      updatedAt: new Date(),
    };
    this.credentials.set(input.id, updated);
    return updated;
  }

  async recordSuccess(id: string): Promise<ConsoleCredentialRecord> {
    const current = this.credentials.get(id);
    if (!current) {
      throw new Error(`unknown credential ${id}`);
    }
    const updated: ConsoleCredentialRecord = {
      ...current,
      failedAttempts: 0,
      lockedUntil: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    };
    this.credentials.set(id, updated);
    return updated;
  }
}

/**
 * Test-only hasher with the same contract as {@link ScryptPasswordHasher} but
 * without the cost: unit tests must stay fast, and the hashing *policy* is what
 * the service tests, not the KDF.
 */
export class FastPasswordHasher implements ConsolePasswordHasher {
  async hash(password: string): Promise<string> {
    return `test$${sha256Hex(password)}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    return constantTimeEqual(encoded, `test$${sha256Hex(password)}`);
  }
}
