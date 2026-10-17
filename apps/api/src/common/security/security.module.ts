import { Module } from '@nestjs/common';

import { InMemoryRateLimiter } from './in-memory-rate-limiter';
import { RequestSizeLimitMiddleware } from './request-size-limit.middleware';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RATE_LIMITER } from './rate-limit.model';
import { SecurityHeadersMiddleware } from './security-headers.middleware';

/**
 * Cross-cutting security (`specs/13-security-spec.md`).
 *
 * Everything here is a side effect of a request: rate limiting and response
 * headers. Both are bound once, and both are replaceable — a shared rate-limit
 * store or a different header policy touches this module only.
 */
@Module({
  providers: [
    SecurityHeadersMiddleware,
    RequestSizeLimitMiddleware,
    RateLimitInterceptor,
    // Single-instance counters today; a Redis-backed limiter implements the same
    // port for a multi-instance deployment.
    { provide: RATE_LIMITER, useClass: InMemoryRateLimiter },
  ],
  exports: [
    SecurityHeadersMiddleware,
    RequestSizeLimitMiddleware,
    RateLimitInterceptor,
    RATE_LIMITER,
  ],
})
export class SecurityModule {}
