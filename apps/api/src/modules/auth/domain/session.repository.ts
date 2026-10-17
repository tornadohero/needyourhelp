import type { AuthSession, CreateSessionInput, SessionRevokedReason } from './auth-session.model';

export const SESSION_REPOSITORY = 'SESSION_REPOSITORY';

/**
 * Persistence port for sessions (`specs/04-database-spec.md` §sessions).
 *
 * Rotation is a single port operation so create-new + revoke-old happens in one
 * transaction (`AGENTS.md` §6 — state changes that must be atomic).
 */
export interface SessionRepository {
  create(input: CreateSessionInput): Promise<AuthSession>;

  findById(id: string): Promise<AuthSession | null>;

  findByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSession | null>;

  /**
   * Atomically create the successor session and revoke the presented one.
   *
   * Refresh tokens rotate on every use; the previous session is revoked or
   * marked rotated (`specs/04-database-spec.md` §sessions notes).
   */
  rotate(input: {
    sessionId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    reason: SessionRevokedReason;
  }): Promise<AuthSession>;

  revoke(sessionId: string, reason: SessionRevokedReason): Promise<void>;

  /** Revoke a session and every session rotated from it (replay containment). */
  revokeChain(rootSessionId: string, reason: SessionRevokedReason): Promise<string[]>;

  setAccessTokenJti(sessionId: string, jti: string): Promise<void>;
}
