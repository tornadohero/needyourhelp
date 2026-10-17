import type { ApiRole } from '@mentor/api-contracts';

/** A persisted session row, mapped onto the domain model. */
export interface AuthSession {
  id: string;
  userId: string;
  /** Hash of the refresh token; the raw token is never stored. */
  refreshTokenHash: string;
  accessTokenJti: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  rotatedFromSessionId: string | null;
  createdAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceLabel?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
}

/** Result of a login or refresh: the raw refresh token is returned exactly once. */
export interface IssuedSession {
  session: AuthSession;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

/** The authenticated subject attached to a request by `JwtAuthGuard`. */
export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  accessTokenJti: string;
  roles: ApiRole[];
  status: 'ACTIVE' | 'SUSPENDED';
}

export const DEFAULT_ROLE: ApiRole = 'USER';

/** Reasons recorded on `sessions.revoked_reason`. */
export const SESSION_REVOKED_REASON = {
  logout: 'LOGOUT',
  rotated: 'ROTATED',
  expired: 'EXPIRED',
  replayDetected: 'REPLAY_DETECTED',
  securityEvent: 'SECURITY_EVENT',
} as const;

export type SessionRevokedReason =
  (typeof SESSION_REVOKED_REASON)[keyof typeof SESSION_REVOKED_REASON];
