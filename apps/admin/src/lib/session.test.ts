import type { LoginResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  SESSION_COOKIE,
  isExpired,
  parseSession,
  serialiseSession,
  sessionFromLogin,
} from './session';

function login(): LoginResponse {
  return {
    tokenType: 'Bearer',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: 900,
    user: { id: 'user-1', displayName: '运营小王', avatarUrl: null, roles: ['ADMIN'] },
  };
}

describe('console session', () => {
  it('keeps the token pair out of reach of scripts: it is only ever serialised', () => {
    expect(SESSION_COOKIE).toBe('mentor_console_session');
    expect(serialiseSession({ accessToken: 'a', refreshToken: 'r' })).toBe(
      '{"accessToken":"a","refreshToken":"r"}',
    );
  });

  it('round-trips a session', () => {
    const session = { accessToken: 'a', refreshToken: 'r', expiresAt: 1_000 };
    expect(parseSession(serialiseSession(session))).toEqual(session);
  });

  it('treats a missing or corrupted cookie as "not signed in"', () => {
    expect(parseSession(undefined)).toBeNull();
    expect(parseSession('')).toBeNull();
    expect(parseSession('{not json')).toBeNull();
    expect(parseSession(JSON.stringify({ accessToken: 'a' }))).toBeNull();
  });

  it('derives the expiry from the server’s own answer, not a local guess', () => {
    const session = sessionFromLogin(login(), 1_000_000);
    expect(session.expiresAt).toBe(1_000_000 + 900 * 1_000);
  });

  it('knows when a session is over', () => {
    const session = sessionFromLogin(login(), 0);
    expect(isExpired(session, 899_000)).toBe(false);
    expect(isExpired(session, 901_000)).toBe(true);
    // Without an expiry there is nothing to expire.
    expect(isExpired({ accessToken: 'a', refreshToken: 'r' }, 10_000_000)).toBe(false);
  });
});
