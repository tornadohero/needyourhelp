import { Injectable } from '@nestjs/common';

import type { RateLimitDecision, RateLimitPolicy, RateLimiter } from './rate-limit.model';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window {@link RateLimiter} for a single instance.
 *
 * It is intentionally the simplest correct thing: one counter per key per
 * window, and the window never slides, so a caller cannot extend it by spacing
 * requests out. A multi-instance deployment replaces this with a shared store
 * (Redis) through the same port — nothing else changes.
 */
@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const now = Date.now();
    const existing = this.windows.get(key);
    const window =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + policy.windowSeconds * 1_000 };

    window.count += 1;
    this.windows.set(key, window);

    const allowed = window.count <= policy.limit;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1_000)),
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - window.count),
    };
  }

  /** Test seam: forget every counter. */
  reset(): void {
    this.windows.clear();
  }
}
