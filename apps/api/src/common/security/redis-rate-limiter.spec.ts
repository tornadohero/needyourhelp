import { describe, expect, it } from 'vitest';

import type { RedisLike } from '../../infrastructure/redis/redis.client';
import { InMemoryRateLimiter } from './in-memory-rate-limiter';
import { RedisRateLimiter } from './redis-rate-limiter';
import type { RateLimitDecision } from './rate-limit.model';

/** A Redis double: the five verbs the platform uses, in memory. */
function fakeRedis(options: { failOn?: 'incr' | 'expire' | 'ttl' } = {}) {
  const values = new Map<string, number>();
  const strings = new Map<string, string>();
  const expiries = new Map<string, number>();
  const calls: string[] = [];

  const client: RedisLike = {
    async incr(key) {
      calls.push(`incr ${key}`);
      if (options.failOn === 'incr') {
        throw new Error('redis is down');
      }
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return next;
    },
    async expire(key, seconds) {
      calls.push(`expire ${key} ${seconds}`);
      if (options.failOn === 'expire') {
        throw new Error('redis is down');
      }
      expiries.set(key, seconds);
      return 1;
    },
    async ttl(key) {
      calls.push(`ttl ${key}`);
      if (options.failOn === 'ttl') {
        throw new Error('redis is down');
      }
      return expiries.get(key) ?? -1;
    },
    async get(key) {
      return strings.get(key) ?? null;
    },
    async set(key, value) {
      strings.set(key, value);
      return 'OK';
    },
    async del(key) {
      const existed = strings.has(key);
      strings.delete(key);
      return existed ? 1 : 0;
    },
  };

  return { client, calls };
}

const POLICY = { limit: 3, windowSeconds: 60, scope: 'ip' as const };

describe('RedisRateLimiter', () => {
  it('counts in Redis so two instances share one window', async () => {
    const { client } = fakeRedis();
    const limiter = new RedisRateLimiter({ redis: client, fallback: new InMemoryRateLimiter() });

    await limiter.consume('ip:1', POLICY);
    await limiter.consume('ip:1', POLICY);
    const third = await limiter.consume('ip:1', POLICY);

    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    // The counter lives in one place: a second instance reads the same value.
    expect(await limiter.consume('ip:1', POLICY)).toMatchObject({ allowed: false });
  });

  it('sets the window length once, so it cannot be extended by waiting', async () => {
    const { client, calls } = fakeRedis();
    const limiter = new RedisRateLimiter({ redis: client, fallback: new InMemoryRateLimiter() });

    await limiter.consume('ip:2', POLICY);
    await limiter.consume('ip:2', POLICY);

    // `EXPIRE` only on the request that opens the window.
    expect(calls.filter((call) => call.startsWith('expire'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('expire'))[0]).toContain('60');
  });

  it('answers an honest Retry-After from the remaining TTL', async () => {
    const { client } = fakeRedis();
    const limiter = new RedisRateLimiter({ redis: client, fallback: new InMemoryRateLimiter() });

    let decision: RateLimitDecision = {
      allowed: true,
      retryAfterSeconds: 0,
      limit: 3,
      remaining: 3,
    };
    for (let i = 0; i < 4; i += 1) {
      decision = await limiter.consume('ip:3', POLICY);
    }

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(60);
  });

  it('falls back to in-process counters when Redis is not configured', async () => {
    const limiter = new RedisRateLimiter({ redis: null, fallback: new InMemoryRateLimiter() });

    expect((await limiter.consume('ip:4', POLICY)).allowed).toBe(true);
  });

  it('falls back when Redis fails, and says so once', async () => {
    const { client } = fakeRedis({ failOn: 'incr' });
    const reasons: string[] = [];
    const limiter = new RedisRateLimiter({
      redis: client,
      fallback: new InMemoryRateLimiter(),
      onFallback: (reason) => reasons.push(reason),
    });

    // A limit that is per-instance is weaker; a 500 on every request is worse.
    expect((await limiter.consume('ip:5', POLICY)).allowed).toBe(true);
    expect(reasons).toEqual(['rate-limit command failed']);
  });
});
