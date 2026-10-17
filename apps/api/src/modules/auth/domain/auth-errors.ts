import type { ErrorCode } from '@mentor/api-contracts';

/**
 * Domain errors for the auth module.
 *
 * The HTTP layer translates these into the API error envelope; the domain layer
 * never depends on NestJS (`AGENTS.md` §6 — domain rules live in domain services).
 */
export class AuthDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthDomainError';
  }
}

/** Invalid/expired/replayed credential, or an unresolvable WeChat code. */
export function invalidCredentials(message = 'Authentication is required.'): AuthDomainError {
  return new AuthDomainError('AUTH_REQUIRED', 401, message);
}

/** Authenticated but not permitted: suspended/deleted account, mock in production. */
export function authForbidden(message = 'Not permitted.'): AuthDomainError {
  return new AuthDomainError('FORBIDDEN', 403, message);
}

/** The upstream WeChat endpoint is unavailable or misconfigured. */
export class WeChatProviderUnavailableError extends Error {
  constructor(message = 'WeChat auth provider is unavailable.') {
    super(message);
    this.name = 'WeChatProviderUnavailableError';
  }
}

/** Mock login attempted outside an isolated dev/test environment. */
export class MockProviderNotAllowedError extends Error {
  constructor(message = 'Mock login is disabled in this environment.') {
    super(message);
    this.name = 'MockProviderNotAllowedError';
  }
}
