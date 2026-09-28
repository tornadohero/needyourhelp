import type { Request } from 'express';

export const REQUEST_ID_KEY = 'requestId';

type RequestWithId = Request & { [REQUEST_ID_KEY]?: string };

/** Read the request id attached by `RequestIdMiddleware`, falling back to a safe default. */
export function getRequestId(request: unknown): string {
  const candidate = (request as RequestWithId | undefined)?.[REQUEST_ID_KEY];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'unknown';
}

export function setRequestId(request: Request, requestId: string): void {
  (request as RequestWithId)[REQUEST_ID_KEY] = requestId;
}
