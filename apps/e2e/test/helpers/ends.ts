import { randomUUID } from 'node:crypto';

import { createAdminClient } from '@mentor/admin';
import type { AdminClient } from '@mentor/admin';
import { ApiClient, MemoryTokenStore, SessionManager } from '@mentor/miniprogram';
import type { MentorContext, Transport, TransportRequest } from '@mentor/miniprogram';

/**
 * The three ends (T035).
 *
 * Each end is the **real client module** pointed at a real server:
 *
 * - the mini program runs its own `ApiClient` and `SessionManager`, with a Node
 *   transport instead of `wx.request`. Nothing else is stubbed: the session
 *   refresh, the envelope unwrapping and the view models are the shipping ones;
 * - the admin console runs its own `createAdminClient`, the same one the Next.js
 *   server actions use;
 * - the API is a process started by `global-setup.ts`.
 *
 * A fourth helper — raw HTTP — exists for exactly two things the clients cannot
 * do yet: mock-gateway payments (the parent payment screen is not built) and the
 * first-administrator bootstrap. Both are named and documented where used.
 */
export function apiUrl(): string {
  const url = process.env.E2E_API_URL;
  if (!url) {
    throw new Error('E2E_API_URL is not set: the three-end suite is skipped without a server.');
  }
  return url;
}

/** `fetch` as the mini program's transport: same shape as `wx.request`. */
export const nodeTransport: Transport = async (request: TransportRequest) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // A non-JSON answer is passed through; the envelope layer reports the status.
  }

  return { status: response.status, body };
};

export function createEnd(): MentorContext {
  const client = new ApiClient({
    origin: apiUrl(),
    transport: nodeTransport,
    requestId: () => randomUUID(),
  });
  const session = new SessionManager({ client, store: new MemoryTokenStore() });
  return { client, session };
}

/** Sign in through the platform's own mock WeChat adapter. */
export async function signIn(end: MentorContext, name: string): Promise<void> {
  await end.session.loginWithCode(`${name}-${randomUUID()}`);
}

export function adminClient(token?: string | null): AdminClient {
  return createAdminClient({
    baseUrl: apiUrl(),
    transport: adminTransport,
    ...(token ? { accessToken: token } : {}),
    requestId: () => randomUUID(),
  });
}

const adminTransport: Parameters<typeof createAdminClient>[0]['transport'] = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: AbortSignal.timeout(request.timeoutMs),
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // Passed through; the envelope layer reports the status.
  }

  return { status: response.status, body };
};

// ---------------------------------------------------------------------------
// Raw HTTP: only for what no client can do yet
// ---------------------------------------------------------------------------

export async function rawCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${apiUrl()}/api/v1${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  let body = text as unknown as T;
  try {
    body = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    // Keep the raw text.
  }
  return { status: response.status, body };
}

export function dataOf<T>(response: { status: number; body: unknown }, expected = 200): T {
  if (response.status !== expected) {
    throw new Error(
      `expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return (response.body as { data: T }).data;
}
