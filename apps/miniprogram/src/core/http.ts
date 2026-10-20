import { API_BASE } from './env';
import { TransportError, unwrap } from './envelope';
import { fillPath, queryString } from './routes';

/**
 * The HTTP client (T028).
 *
 * It is deliberately transport-agnostic: `wx.request` is injected, so the core is
 * testable in Node and the platform adapter stays a thin shell (`AGENTS.md` §6).
 *
 * Rules it enforces for every screen:
 * - the base path is always `/api/v1`;
 * - JSON only, and unknown fields are never sent (the server refuses them);
 * - a request id is always sent, so a support ticket can be traced to a log line;
 * - money endpoints can carry an idempotency key, supplied by the caller.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface RequestOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Bearer token; omitted when the caller is not signed in yet. */
  accessToken?: string | null;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface ApiClientOptions {
  origin: string;
  transport: Transport;
  /** Injected so tests can pin the id; production uses a random one. */
  requestId?: () => string;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly origin: string;
  private readonly transport: Transport;
  private readonly requestId: () => string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.origin = options.origin.replace(/\/+$/, '');
    this.transport = options.transport;
    this.requestId = options.requestId ?? defaultRequestId;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  get<T>(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  patch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  put<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, options);
  }

  delete<T>(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const filled = fillPath(path, options.params);
    const url = `${this.origin}${API_BASE}${filled}${queryString(options.query)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-Id': this.requestId(),
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

    let response: TransportResponse;
    try {
      response = await this.transport({
        method,
        url,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        timeoutMs: options.timeoutMs ?? this.timeoutMs,
      });
    } catch {
      // No answer at all: offline, DNS, or a timeout.
      throw new TransportError();
    }

    return unwrap<T>(response.status, response.body);
  }
}

function defaultRequestId(): string {
  // WeChat has no crypto.randomUUID; a timestamp plus randomness is enough for
  // correlation, and the server ignores a malformed value.
  return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
