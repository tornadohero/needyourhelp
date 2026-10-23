import { Injectable } from '@nestjs/common';

import type { RedisLike } from '../../infrastructure/redis/redis.client';
import { redisKey } from '../../infrastructure/redis/redis.client';
import {
  IdempotencyConflictError,
  type IdempotencyRequest,
  type IdempotencyResult,
  type IdempotencyStore,
} from './idempotency.store';

/**
 * Shared idempotency (T034).
 *
 * A refund or a payment session must not be applied twice, even when the retry
 * lands on a different instance. The claim is `SET ... NX`: whichever instance
 * wins runs the work, every other caller either replays the stored answer or is
 * refused.
 *
 * Three outcomes, and only three:
 * - **first call** — claim taken, work runs, answer stored;
 * - **retry** — claim held by the same fingerprint, answer replayed;
 * - **abuse** — same key, different payload: `IdempotencyConflictError`
 *   (`IDEMPOTENCY_CONFLICT`, 409), never a silent replay of an unrelated answer.
 *
 * A retry that lands while the first call is still running waits briefly for the
 * answer and then refuses: running the work twice would break the promise the
 * key makes. Redis being unavailable degrades to the in-process store, which is
 * correct for a single instance and wrong for more — the deployment note in
 * `ops/` is what keeps that honest.
 */
export interface RedisIdempotencyStoreOptions {
  redis: RedisLike | null;
  fallback: IdempotencyStore;
  /** How long a stored answer is replayable, in seconds. */
  ttlSeconds?: number;
  /** How long a retry waits for an answer that is still being produced. */
  waitMs?: number;
  onFallback?: (reason: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_WAIT_MS = 2_000;

@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly ttlSeconds: number;
  private readonly waitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RedisIdempotencyStoreOptions) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async runOnce<T>(
    request: IdempotencyRequest,
    work: () => Promise<T>,
  ): Promise<IdempotencyResult<T>> {
    const redis = this.options.redis;
    if (redis === null) {
      return this.options.fallback.runOnce(request, work);
    }

    try {
      return await this.runOnceWith<T>(redis, request, work);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw error;
      }
      this.options.onFallback?.('idempotency command failed');
      return this.options.fallback.runOnce(request, work);
    }
  }

  private async runOnceWith<T>(
    redis: RedisLike,
    request: IdempotencyRequest,
    work: () => Promise<T>,
  ): Promise<IdempotencyResult<T>> {
    const claimKey = redisKey('idempotency', request.scope, request.key);
    const resultKey = `${claimKey}:result`;

    // `SET NX` is the whole mechanism: one winner, everyone else reads.
    const claimed = await redis.set(claimKey, request.fingerprint, 'NX', 'EX', this.ttlSeconds);

    if (claimed === null) {
      const holder = await redis.get(claimKey);
      if (holder !== request.fingerprint) {
        throw new IdempotencyConflictError();
      }

      const stored = await this.awaitResult(redis, resultKey);
      if (stored === null) {
        // Still running: running it again would break the promise of the key.
        throw new IdempotencyConflictError();
      }
      return { result: JSON.parse(stored) as T, replayed: true };
    }

    let result: T;
    try {
      result = await work();
    } catch (error) {
      // A failed `work` stores nothing: the claim is released so a retry runs it
      // again, instead of being refused forever by its own failure.
      await redis.del(claimKey);
      throw error;
    }

    await redis.set(resultKey, JSON.stringify(result), 'EX', this.ttlSeconds);
    return { result, replayed: false };
  }

  /** Give a concurrent retry a moment to see the answer before refusing it. */
  private async awaitResult(redis: RedisLike, resultKey: string): Promise<string | null> {
    const step = 50;
    for (let waited = 0; waited < this.waitMs; waited += step) {
      const stored = await redis.get(resultKey);
      if (stored !== null) {
        return stored;
      }
      await this.sleep(step);
    }
    return (await redis.get(resultKey)) ?? null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
