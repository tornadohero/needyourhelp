import { describe, expect, it } from 'vitest';

import { ApiClient } from './http';
import type { Transport } from './http';
import { ApiError } from './envelope';
import { MemoryTokenStore, SessionExpiredError, SessionManager } from './session';
import type { SessionTokens } from './session';

type Answer = { status: number; body: unknown } | 'offline';

interface Recorded {
  method: string;
  url: string;
  body?: string;
}

function harness(options: { answers?: Answer[]; now?: () => number } = {}) {
  const answers = [...(options.answers ?? [])];
  const calls: Recorded[] = [];

  const transport: Transport = async (request) => {
    calls.push({ method: request.method, url: request.url, body: request.body });
    const next = answers.shift();
    if (next === undefined) {
      throw new Error('no answer queued');
    }
    if (next === 'offline') {
      throw new Error('network down');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({
    client,
    store,
    now: options.now ?? (() => 1_700_000_000_000),
  });

  return { client, session, store, calls };
}

const LOGIN_ANSWER = {
  status: 200,
  body: { data: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 } },
};

function data(body: unknown): Answer {
  return { status: 200, body: { data: body } };
}

function failure(status: number, code: string): Answer {
  return { status, body: { error: { code, message: 'refused' } } };
}

describe('SessionManager', () => {
  it('exchanges a wx.login code and stores what the server issued', async () => {
    const { session, store, calls } = harness({ answers: [LOGIN_ANSWER] });

    const tokens = await session.loginWithCode('wx-code');

    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/auth/wechat/login');
    expect(calls[0]?.method).toBe('POST');
    // Only the code is sent: no role, no user id, no profile (`AGENTS.md` §7).
    expect(calls[0]?.body).toBe('{"code":"wx-code"}');
    expect(tokens.accessToken).toBe('access-1');
    expect(store.get()?.refreshToken).toBe('refresh-1');
    expect(session.isSignedIn).toBe(true);
  });

  it('refreshes once when two requests fail at the same time', async () => {
    const { session, calls } = harness({
      answers: [
        LOGIN_ANSWER,
        data({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 }),
      ],
    });

    await session.loginWithCode('wx-code');

    const work = (accessToken: string): Promise<string> => {
      if (accessToken === 'access-1') {
        return Promise.reject(new ApiError('AUTH_REQUIRED', 401, 'expired'));
      }
      return Promise.resolve(`done:${accessToken}`);
    };

    const results = await Promise.all([session.withSession(work), session.withSession(work)]);

    expect(results).toEqual(['done:access-2', 'done:access-2']);
    // One refresh, not one per failed request: a rotated token can only be used once.
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('retries a request exactly once after a refresh', async () => {
    const { session, calls } = harness({
      answers: [
        LOGIN_ANSWER,
        data({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 }),
        failure(401, 'AUTH_REQUIRED'),
      ],
    });
    await session.loginWithCode('wx-code');

    let attempts = 0;
    const work = (accessToken: string): Promise<string> => {
      attempts += 1;
      if (accessToken === 'access-1') {
        return Promise.reject(new ApiError('AUTH_REQUIRED', 401, 'expired'));
      }
      return Promise.reject(new ApiError('AUTH_REQUIRED', 401, 'still expired'));
    };

    await expect(session.withSession(work)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    // Two attempts, one refresh: no loop.
    expect(attempts).toBe(2);
    expect(calls.filter((call) => call.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the session when the refresh is refused', async () => {
    const { session, store } = harness({
      answers: [LOGIN_ANSWER, failure(401, 'AUTH_REQUIRED')],
    });
    await session.loginWithCode('wx-code');

    await expect(session.refresh()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(store.get()).toBeNull();
    expect(session.isSignedIn).toBe(false);
  });

  it('refuses to work without a session instead of calling anonymously', async () => {
    const { session, calls } = harness();

    await expect(session.withSession(async () => 'never')).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(calls).toHaveLength(0);
  });

  it('refreshes a little before the access token expires', () => {
    const now = 1_700_000_000_000;
    const { session, store } = harness({ now: () => now });

    const tokens: SessionTokens = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: now / 1000 + 10,
    };
    store.set(tokens);

    // Inside the 60s skew: refresh first rather than race the expiry.
    expect(session.needsRefresh()).toBe(true);
  });

  it('forgets the session on logout even when the call cannot reach the server', async () => {
    const { session, store } = harness({ answers: [LOGIN_ANSWER, 'offline'] });
    await session.loginWithCode('wx-code');

    // A transport failure is swallowed: the local session is already gone.
    await expect(session.logout()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
  });
});
