import type { Request } from 'express';

const BEARER_PREFIX = /^Bearer\s+/i;

/** Read the bearer token from the `Authorization` header, if present. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const token = header.replace(BEARER_PREFIX, '').trim();
  return token.length > 0 ? token : null;
}
