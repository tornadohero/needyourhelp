import { Logger, Module } from '@nestjs/common';

import { REDIS } from '../../infrastructure/redis/redis.module';
import type { RedisHandle } from '../../infrastructure/redis/redis.client';
import { InMemoryRateLimiter } from './in-memory-rate-limiter';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RequestSizeLimitMiddleware } from './request-size-limit.middleware';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RATE_LIMITER } from './rate-limit.model';
import type { RateLimiter } from './rate-limit.model';
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
    {
      // Shared counters when Redis is configured, in-process counters when it is
      // not: the port is the same either way, so no route knows the difference.
      provide: RATE_LIMITER,
      inject: [{ token: REDIS, optional: true }],
      useFactory: (redis: RedisHandle | undefined): RateLimiter => {
        const memory = new InMemoryRateLimiter();
        // No handle bound (a module built without Redis) is the same as no Redis.
        if (redis === undefined || !redis.enabled || redis.client === null) {
          return memory;
        }
        return new RedisRateLimiter({
          redis: redis.client,
          fallback: memory,
          // Logged once: a limit that is not shared is a deployment note, not a
          // request-level event.
          onFallback: (reason) =>
            new Logger('RateLimit').warn(`falling back to in-process counters: ${reason}`),
        });
      },
    },
  ],
  exports: [
    SecurityHeadersMiddleware,
    RequestSizeLimitMiddleware,
    RateLimitInterceptor,
    RATE_LIMITER,
  ],
})
export class SecurityModule {}
