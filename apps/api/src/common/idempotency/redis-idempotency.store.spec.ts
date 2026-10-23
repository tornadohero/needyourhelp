import { describe, expect, it } from 'vitest';

import type { RedisLike } from '../../infrastructure/redis/redis.client';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import { IdempotencyConflictError } from './idempotency.store';
import { RedisIdempotencyStore } from './redis-idempotency.store';

function fakeRedis(options: { failOn?: 'set' | 'get' } = {}) {
  const strings = new Map<string, string>();
  const ttls = new Map<string, number>();
  const calls: string[] = [];

  const client: RedisLike = {
    async incr(key) {
      return Number(strings.get(key) ?? 0) + 1;
    },
    async expire(key, seconds) {
      ttls.set(key, seconds);
      return 1;
    },
    async ttl(key) {
      return ttls.get(key) ?? -1;
    },
    async get(key) {
      calls.push(`get ${key}`);
      if (options.failOn === 'get') {
        throw new Error('redis is down');
      }
      return strings.get(key) ?? null;
    },
    async del(key) {
      const existed = strings.has(key);
      strings.delete(key);
      return existed ? 1 : 0;
    },
    async set(key, value, ...args) {
      calls.push(`set ${key} ${args.join(' ')}`);
      if (options.failOn === 'set') {
        throw new Error('redis is down');
      }
      // Honour `NX`: an existing key is never overwritten.
      if (args[0] === 'NX' && strings.has(key)) {
        return null;
      }
      strings.set(key, value);
      if (args.includes('EX')) {
        ttls.set(key, Number(args[args.indexOf('EX') + 1]));
      }
      return 'OK';
    },
  };

  return { client, calls, strings };
}

function request(overrides: Partial<{ scope: string; key: string; fingerprint: string }> = {}) {
  return {
    scope: 'refunds',
    key: 'idem-1',
    fingerprint: 'fp-1',
    ...overrides,
  };
}

describe('RedisIdempotencyStore', () => {
  it('runs the work once and replays the stored answer on a retry', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
    });

    const first = await store.runOnce(request(), async () => ({ refundId: 'r1' }));
    const second = await store.runOnce(request(), async () => ({ refundId: 'r2' }));

    expect(first).toEqual({ result: { refundId: 'r1' }, replayed: false });
    // The second call never ran: the answer of the first one came back.
    expect(second).toEqual({ result: { refundId: 'r1' }, replayed: true });
  });

  it('keeps the claim separate from the answer, and both expire', async () => {
    const { client, calls } = fakeRedis();
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
      ttlSeconds: 120,
    });

    await store.runOnce(request(), async () => ({ ok: true }));

    // Claim is conditional; the answer is stored after the work succeeded.
    expect(calls[0]).toContain('NX');
    expect(calls[0]).toContain('EX');
    expect(calls[0]).toContain('120');
  });

  it('refuses the same key with a different payload instead of replaying', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
    });

    await store.runOnce(request({ fingerprint: 'fp-1' }), async () => 1);

    await expect(
      store.runOnce(request({ fingerprint: 'fp-2' }), async () => 2),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('refuses a retry that arrives while the first call is still running', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
      waitMs: 100,
      sleep: async () => undefined,
    });

    let release: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = store.runOnce(request(), async () => {
      await running;
      return 'done';
    });

    // Running it twice would break the promise the key makes.
    await expect(store.runOnce(request(), async () => 'again')).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );

    release();
    await slow;
  });

  it('stores nothing when the work fails, so a retry runs it again', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
    });

    await expect(
      store.runOnce(request(), async () => {
        throw new Error('gateway down');
      }),
    ).rejects.toThrow('gateway down');

    const retry = await store.runOnce(request(), async () => 'ok');
    expect(retry).toEqual({ result: 'ok', replayed: false });
  });

  it('falls back to the in-process store when Redis is not configured', async () => {
    const store = new RedisIdempotencyStore({
      redis: null,
      fallback: new InMemoryIdempotencyStore(),
    });

    const first = await store.runOnce(request(), async () => 'one');
    const second = await store.runOnce(request(), async () => 'two');

    expect(first.replayed).toBe(false);
    expect(second).toEqual({ result: 'one', replayed: true });
  });

  it('falls back when Redis fails', async () => {
    const { client } = fakeRedis({ failOn: 'set' });
    const reasons: string[] = [];
    const store = new RedisIdempotencyStore({
      redis: client,
      fallback: new InMemoryIdempotencyStore(),
      onFallback: (reason) => reasons.push(reason),
    });

    await expect(store.runOnce(request(), async () => 'ok')).resolves.toEqual({
      result: 'ok',
      replayed: false,
    });
    expect(reasons).toEqual(['idempotency command failed']);
  });
});
