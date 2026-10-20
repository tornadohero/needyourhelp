import { authForbidden } from './auth-errors';

/**
 * Admin console credential rules (T028 gap G1).
 *
 * The console is the only place where a password exists in this product: the
 * mini program logs in with WeChat. That makes the console credential the most
 * attractive target on the platform, so the rules are stricter than a typical
 * user password and failure is counted and locked.
 */

export const CONSOLE_USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;
export const CONSOLE_PASSWORD_MIN_LENGTH = 12;
export const CONSOLE_PASSWORD_MAX_LENGTH = 128;

/** Failed attempts before the credential is frozen. */
export const CONSOLE_MAX_FAILED_ATTEMPTS = 5;
/** How long a frozen credential stays unusable. */
export const CONSOLE_LOCK_SECONDS = 15 * 60;

/** Roles that may hold a console credential. Never taken from the client. */
export const CONSOLE_ROLES = ['ADMIN', 'OPS'] as const;

/** Usernames are case-insensitive and stored normalised. */
export function assertUsername(username: string): string {
  const normalised = username.trim().toLowerCase();
  if (!CONSOLE_USERNAME_PATTERN.test(normalised)) {
    throw authForbidden(
      'A console username is 3-64 characters of a-z, 0-9, dot, underscore or dash.',
    );
  }
  return normalised;
}

export function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length < CONSOLE_PASSWORD_MIN_LENGTH) {
    throw authForbidden(
      `A console password is at least ${CONSOLE_PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (password.length > CONSOLE_PASSWORD_MAX_LENGTH) {
    throw authForbidden(`A console password is at most ${CONSOLE_PASSWORD_MAX_LENGTH} characters.`);
  }
}

export function isLocked(lockedUntil: Date | null, now = new Date()): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/** How many failures freeze the credential: `null` when it stays usable. */
export function lockoutFor(failedAttempts: number): Date | null {
  return failedAttempts >= CONSOLE_MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + CONSOLE_LOCK_SECONDS * 1000)
    : null;
}

export function hasAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((role) => allowed.includes(role));
}
