import { cookies } from 'next/headers';

import { createAdminClient } from './client';
import type { AdminClient } from './client';
import { resolveApiBaseUrl } from './env';
import {
  SESSION_COOKIE,
  isExpired,
  parseSession,
  serialiseSession,
  sessionFromLogin,
} from './session';
import type { ConsoleSession } from './session';

/**
 * Server-side session plumbing (T033).
 *
 * Cookies are readable in server components but only **writable** in server
 * actions and route handlers, so a refresh that happens while rendering cannot
 * persist. The console accepts that: a read with an expired session redirects to
 * login, and every mutation runs in a server action where renewal can be stored.
 */
export async function readSession(): Promise<ConsoleSession | null> {
  const store = await cookies();
  const session = parseSession(store.get(SESSION_COOKIE)?.value);
  if (session === null) {
    return null;
  }
  return isExpired(session) ? null : session;
}

export async function writeSession(session: ConsoleSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, serialiseSession(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** A client bound to the current session, or `null` when there is none. */
export async function clientForSession(): Promise<AdminClient | null> {
  const session = await readSession();
  if (session === null) {
    return null;
  }
  return createAdminClient({
    baseUrl: resolveApiBaseUrl(),
    transport: fetchTransport,
    accessToken: session.accessToken,
  });
}

/** A client with no session: login, bootstrap. */
export function anonymousClient(): AdminClient {
  return createAdminClient({ baseUrl: resolveApiBaseUrl(), transport: fetchTransport });
}

/** Store a fresh login as the console's session. */
export async function rememberLogin(login: Parameters<typeof sessionFromLogin>[0]): Promise<void> {
  await writeSession(sessionFromLogin(login));
}

/**
 * `fetch` as a {@link Transport}.
 *
 * The timeout is enforced with `AbortSignal`: a hung API must not hang a page.
 */
const fetchTransport: Parameters<typeof createAdminClient>[0]['transport'] = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: AbortSignal.timeout(request.timeoutMs),
    // The console reads live operational state; nothing here is cacheable.
    cache: 'no-store',
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // A non-JSON answer is passed through: the error path reports the status.
  }

  return { status: response.status, body };
};
