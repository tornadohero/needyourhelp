/**
 * The response envelope, as the platform answers it (`T001`, `specs/05`).
 *
 * Success is `{ data, requestId }`, failure is `{ error: { code, message }, requestId }`.
 * Clients branch on `code`, never on `message` — the message is for humans and
 * may change without a version bump.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** `true` only for an expired/missing session: the one error worth a refresh. */
  get isUnauthorized(): boolean {
    return this.code === 'AUTH_REQUIRED';
  }

  /** Rate limiting carries a retry hint; everything else is not worth retrying blindly. */
  get isRateLimited(): boolean {
    return this.code === 'RATE_LIMITED';
  }
}

/** A transport failure (no answer at all), kept distinct from an API refusal. */
export class TransportError extends Error {
  constructor(message = 'The server could not be reached.') {
    super(message);
    this.name = 'TransportError';
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

/**
 * Unwrap a response body.
 *
 * Anything that is not the documented envelope is treated as a failure with
 * `INTERNAL_ERROR`: an unexpected shape is never passed to a screen as data.
 */
export function unwrap<T>(status: number, body: unknown): T {
  const record = asRecord(body);
  const requestId = typeof record.requestId === 'string' ? record.requestId : undefined;

  if (status >= 200 && status < 300 && 'data' in record) {
    return record.data as T;
  }

  const error = asRecord(record.error);
  const code = typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const message =
    typeof error.message === 'string' ? error.message : 'The request could not be completed.';

  throw new ApiError(code, status, message, requestId);
}
