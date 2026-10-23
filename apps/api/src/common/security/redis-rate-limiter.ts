import { Injectable } from '@nestjs/common';

import type { RedisLike } from '../../infrastructure/redis/redis.client';
import { redisKey } from '../../infrastructure/redis/redis.client';
import type { RateLimitDecision, RateLimitPolicy, RateLimiter } from './rate-limit.model';

/**
 * Shared fixed-window {@link RateLimiter} (T034).
 *
 * Two instances of the API must agree on how many requests an address has made,
 * otherwise the limit is per instance and a client that spreads its traffic gets
 * twice the budget. Redis keeps one counter per key:
 *
 * - `INCR` is atomic, so two concurrent requests can never read the same count;
 * - `EXPIRE` is set only when the counter is created, so a window never slides —
 *   a caller cannot extend it by spacing requests out;
 * - `TTL` gives the honest `Retry-After`, the same number the in-process limiter
 *   answers with.
 *
 * Redis going away degrades to the in-process counters: a limit that is
 * per-instance is weaker than a shared one, but a 500 on every request is worse
 * than both. The platform logs the fallback and carries on.
 */
export interface RedisRateLimiterOptions {
  redis: RedisLike | null;
  /** Used when Redis is absent, unreachable, or answers nonsense. */
  fallback: RateLimiter;
  /** Reports a fallback once per process, so the log says it without flooding. */
  onFallback?: (reason: string) => void;
}

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly options: RedisRateLimiterOptions) {}

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const redis = this.options.redis;
    if (redis === null) {
      return this.options.fallback.consume(key, policy);
    }

    try {
      return await this.consumeWith(redis, key, policy);
    } catch {
      this.options.onFallback?.('rate-limit command failed');
      return this.options.fallback.consume(key, policy);
    }
  }

  private async consumeWith(
    redis: RedisLike,
    key: string,
    policy: RateLimitPolicy,
  ): Promise<RateLimitDecision> {
    const redisKeyValue = redisKey('rate-limit', key);
    const count = await redis.incr(redisKeyValue);

    // Only the request that opens the window sets its length.
    if (count === 1) {
      await redis.expire(redisKeyValue, policy.windowSeconds);
    }

    const ttl = await redis.ttl(redisKeyValue);
    const windowSeconds = ttl > 0 ? ttl : policy.windowSeconds;
    const allowed = count <= policy.limit;

    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, windowSeconds),
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
    };
  }
}
