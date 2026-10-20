/**
 * Auth contract (T003).
 *
 * Source of truth: `specs/05-api-spec.md` §Auth, `specs/04-database-spec.md`
 * §sessions, `specs/13-security-spec.md` §Authentication.
 *
 * Every payload here is an allowlist: tokens and profile fields are explicitly
 * enumerated, ORM entities are never serialized
 * (`AGENTS.md` §10, `specs/10-privacy-and-minors.md` §Data access).
 */

export const TOKEN_TYPE = 'Bearer' as const;

/** `users.status` (`specs/04-database-spec.md` §users). */
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type UserStatusName = (typeof USER_STATUSES)[number];

/** Roles as returned by the API (`specs/01-business-rules.md` §Account and roles). */
export type ApiRole =
  'USER' | 'PARENT' | 'STUDENT' | 'PROVIDER' | 'ADMIN' | 'OPS' | 'FINANCE' | 'MODERATOR';

/**
 * Minimal user projection returned with a session.
 *
 * Deliberately excludes `wechat_openid_hash`, `unionid_hash` and
 * `phone_encrypted` (`AGENTS.md` §9).
 */
export interface AuthUserResponse {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  roles: ApiRole[];
}

/**
 * Session tokens. `refreshToken` is returned once and is never persisted in
 * clear text server-side (`specs/04-database-spec.md` §sessions notes).
 */
export interface AuthTokensResponse {
  tokenType: typeof TOKEN_TYPE;
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds; lets the client schedule a refresh. */
  expiresIn: number;
}

export interface LoginResponse extends AuthTokensResponse {
  user: AuthUserResponse;
}

export interface LogoutResponse {
  revoked: true;
}

/** `GET /me` payload: account status plus the roles assigned server-side. */
export interface MeResponse {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: ApiRole[];
}

/**
 * Admin console credential (T028 gap G1).
 *
 * The admin web needs a login that is not `wx.login()`. The credential is issued
 * by an existing operator to an account that already holds `ADMIN` or `OPS`;
 * login proves the role, it never grants one.
 *
 * The response is an allowlist on purpose: no password, no hash, no failure
 * counters beyond what an operator needs to see.
 */
export interface ConsoleCredentialResponse {
  userId: string;
  username: string;
  /** `true` when issuing replaced an existing credential (a rotation). */
  rotated: boolean;
}

export interface ConsoleCredentialRevocationResponse {
  userId: string;
  revoked: true;
}
