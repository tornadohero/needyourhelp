import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';

import type { AuthPrincipal } from '../../domain/auth-session.model';

const PRINCIPAL_KEY = 'authPrincipal';

export interface AuthenticatedRequest {
  [PRINCIPAL_KEY]?: AuthPrincipal;
}

/** Read the principal attached by `JwtAuthGuard`. */
export function readPrincipal(request: unknown): AuthPrincipal | undefined {
  return (request as AuthenticatedRequest | undefined)?.[PRINCIPAL_KEY];
}

export function writePrincipal(request: unknown, principal: AuthPrincipal): void {
  (request as AuthenticatedRequest)[PRINCIPAL_KEY] = principal;
}

/** `@CurrentUser()` — the authenticated subject resolved server-side. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const principal = readPrincipal(context.switchToHttp().getRequest());
    if (!principal) {
      // Guards must run first; reaching here means the route is misconfigured.
      throw new Error('CurrentUser used without JwtAuthGuard.');
    }
    return principal;
  },
);

/**
 * `@MaybeCurrentUser()` — the principal when the caller is authenticated,
 * `undefined` otherwise (routes that accept both, e.g. logout).
 */
export const MaybeCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal | undefined =>
    readPrincipal(context.switchToHttp().getRequest()),
);
