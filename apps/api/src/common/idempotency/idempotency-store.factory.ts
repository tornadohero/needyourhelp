import { Logger } from '@nestjs/common';

import type { RedisHandle } from '../../infrastructure/redis/redis.client';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import type { IdempotencyStore } from './idempotency.store';
import { RedisIdempotencyStore } from './redis-idempotency.store';

/**
 * Pick the idempotency store once, at boot (T034).
 *
 * Payment sessions and refunds both promise "at most once". With Redis that
 * promise holds across instances; without it, it holds inside one instance and
 * the deployment must run exactly one. The factory is the single place that
 * decision is made, and the fallback is logged — a silent downgrade would be the
 * kind of surprise an operator discovers during an incident.
 */
export function idempotencyStoreFor(
  redis: RedisHandle | undefined,
  context: string,
): IdempotencyStore {
  const memory = new InMemoryIdempotencyStore();

  // Absent handle (a module built without Redis, or Redis not configured) is the
  // same decision: single-instance idempotency, and the deployment runs one.
  if (redis === undefined || !redis.enabled || redis.client === null) {
    return memory;
  }

  return new RedisIdempotencyStore({
    redis: redis.client,
    fallback: memory,
    onFallback: (reason) =>
      new Logger('Idempotency').warn(`${context}: falling back to in-process store: ${reason}`),
  });
}
