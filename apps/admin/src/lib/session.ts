import type { LoginResponse } from '@mentor/api-contracts';

/**
 * Console session (T033).
 *
 * The access token lives in an httpOnly, same-site cookie and is only ever read
 * on the server: the browser never holds it, so no script can leak it
 * (`specs/13-security-spec.md`). The refresh token is kept the same way because
 * the console's own session renewal also happens server-side.
 *
 * Serialisation is deliberately pure and exported: it is what the tests cover.
 */
export const SESSION_COOKIE = 'mentor_console_session';

export interface ConsoleSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds; absent when the server did not say. */
  expiresAt?: number;
}

export function serialiseSession(session: ConsoleSession): string {
  return JSON.stringify(session);
}

export function parseSession(raw: string | undefined | null): ConsoleSession | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConsoleSession>;
    if (!parsed.accessToken || !parsed.refreshToken) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      ...(typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : {}),
    };
  } catch {
    // A corrupted cookie is "not signed in", never a crash.
    return null;
  }
}

/** Turn a login answer into a session, using the server's own expiry. */
export function sessionFromLogin(login: LoginResponse, now = Date.now()): ConsoleSession {
  return {
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
    expiresAt: now + Math.max(login.expiresIn, 0) * 1_000,
  };
}

export function isExpired(session: ConsoleSession, now = Date.now()): boolean {
  return typeof session.expiresAt === 'number' && session.expiresAt <= now;
}
