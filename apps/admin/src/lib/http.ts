import { API_BASE, REQUEST_ID_HEADER } from '@mentor/api-contracts';

import { actionFor, messageFor } from './errors';
import type { ErrorAction } from './errors';

/**
 * The console's transport (T033).
 *
 * Every call goes to the API from the **server** (a server component or a server
 * action), so the browser never holds an access token and CORS never applies.
 * `fetch` and the request id are injected, which is what makes the client below
 * testable without a network.
 *
 * Rules it enforces for every page:
 * - the base path is always `/api/v1`;
 * - a request id is always sent, so a log line can be found from a ticket;
 * - the `{ data }` envelope is unwrapped once, and an error envelope becomes an
 *   {@link AdminApiError} carrying the platform's own code.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ErrorEnvelope {
  error: { code: string; message?: string };
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly action: ErrorAction;
  readonly requestId: string | null;

  constructor(options: {
    status: number;
    code: string;
    action: ErrorAction;
    requestId: string | null;
  }) {
    super(messageFor(options.code));
    this.name = 'AdminApiError';
    this.status = options.status;
    this.code = options.code;
    this.action = options.action;
    this.requestId = options.requestId;
  }
}

export interface RequestOptions {
  method?: HttpMethod;
  /** `:name` placeholders in the path. */
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Bearer token; the console sends it only when it has a session. */
  accessToken?: string | null;
  /** Money and decision commands carry one so a retry cannot double-apply. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

export type Transport = (request: {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}) => Promise<TransportResponse>;

export interface ApiRequestOptions extends RequestOptions {
  baseUrl: string;
  path: string;
  transport: Transport;
  requestId?: () => string;
}

/** Replace `:name` placeholders; a leftover placeholder is a bug, not a URL. */
export function fillPath(path: string, params: Record<string, string> = {}): string {
  let filled = path;
  for (const [name, value] of Object.entries(params)) {
    filled = filled.replace(`:${name}`, encodeURIComponent(value));
  }
  if (filled.includes(':')) {
    throw new Error(`Unfilled parameter in route ${path}`);
  }
  return filled;
}

export function queryString(
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function defaultRequestId(): string {
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One call: build it, send it, unwrap it. */
export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const { transport, baseUrl, path } = options;
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? 10_000;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    [REQUEST_ID_HEADER]: (options.requestId ?? defaultRequestId)(),
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}${API_BASE}${fillPath(path, options.params ?? {})}${queryString(
    options.query,
  )}`;

  let response: TransportResponse;
  try {
    response = await transport({
      method,
      url,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      timeoutMs,
    });
  } catch {
    throw new AdminApiError({
      status: 0,
      code: 'TRANSPORT_ERROR',
      action: 'retry',
      requestId: null,
    });
  }

  return unwrap<T>(response.status, response.body);
}

/** `{data}` out, error envelope → typed error. */
export function unwrap<T>(status: number, body: unknown): T {
  const envelope = body as { data?: T; error?: ErrorEnvelope['error'] } | null;
  const code = envelope?.error?.code;

  if (status >= 400 || typeof code === 'string') {
    throw new AdminApiError({
      status,
      code: code ?? 'INTERNAL_ERROR',
      action: actionFor(code ?? 'INTERNAL_ERROR'),
      requestId: null,
    });
  }

  return (envelope?.data ?? body) as T;
}
