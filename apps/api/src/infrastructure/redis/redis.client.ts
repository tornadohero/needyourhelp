import type Redis from 'ioredis';

/**
 * Redis, when there is one (T034).
 *
 * The platform uses Redis for exactly two things — rate-limit counters and
 * idempotency keys (`AGENTS.md` §5, `specs/03-architecture-spec.md`
 * §Idempotency). Both are shared state between instances, and both must survive
 * a single process restart without becoming wrong.
 *
 * It is deliberately **optional**: no `REDIS_URL` means a single instance, and
 * the two stores fall back to their in-process implementations. A deployment
 * that runs more than one instance without Redis is a deployment whose limits
 * are per-instance — the health probe says so, and the docs say so, but the
 * platform still runs.
 */
export const REDIS_URL_ENV = 'REDIS_URL';

/**
 * The commands the platform uses, and nothing else.
 *
 * Narrow on purpose: an adapter that offers five verbs can be faked in a test,
 * and a future client (or a managed service) only has to satisfy these.
 */
export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  /** Releases a claim whose work failed (`DEL`). */
  del(key: string): Promise<number>;
}

export interface RedisHandle {
  /** `null` when Redis is not configured. */
  client: RedisLike | null;
  url: string | null;
  enabled: boolean;
  /** Ends the connection; a no-op when there is none. */
  close(): Promise<void>;
}

/** Empty, blank or the literal `disabled` all mean "no Redis". */
export function resolveRedisUrl(configured?: string | null): string | null {
  const value = (configured ?? '').trim();
  if (value.length === 0 || value.toLowerCase() === 'disabled') {
    return null;
  }
  return value;
}

/**
 * Connect, or decide not to.
 *
 * The client is created lazily and never retries forever: a Redis outage must
 * slow the platform down, not hang it. Callers fall back to the in-process
 * store when a command throws, so a failure here is never fatal to boot.
 */
export async function createRedisHandle(configured?: string | null): Promise<RedisHandle> {
  const url = resolveRedisUrl(configured);
  if (url === null) {
    return { client: null, url: null, enabled: false, close: async () => undefined };
  }

  const { default: RedisClient } = await import('ioredis');
  const client: Redis = new RedisClient(url, {
    // Fail fast rather than queueing commands forever while Redis is away.
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    connectTimeout: 1_000,
    // Nothing is queued while the connection is down: a command that cannot run
    // now is a fallback now, not a request that hangs.
    enableOfflineQueue: false,
    // Give up instead of reconnecting forever: a deployment without Redis must
    // settle into "no Redis", and a test run must be able to exit.
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 600)),
  });

  // Without a listener, a connection error would take the process down.
  client.on('error', () => undefined);

  return {
    client: client as unknown as RedisLike,
    url,
    enabled: true,
    close: async () => {
      await client.quit().catch(() => client.disconnect());
    },
  };
}

/** Namespaced key: every key the platform writes starts with this. */
export function redisKey(...parts: string[]): string {
  return `mentor:${parts.join(':')}`;
}
