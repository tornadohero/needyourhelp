import { Injectable } from '@nestjs/common';

import {
  IdempotencyConflictError,
  type IdempotencyRequest,
  type IdempotencyResult,
  type IdempotencyStore,
} from './idempotency.store';

/**
 * Single-instance idempotency store.
 *
 * It is correct for tests and for one running instance; a multi-instance
 * deployment needs the durable Redis-backed implementation, which belongs to
 * T022 (`AGENTS.md` §5: Redis for idempotency). Until then the port is what the
 * application depends on, so swapping the adapter changes no use case.
 */
@Injectable()
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, { fingerprint: string; result: unknown }>();

  async runOnce<T>(
    request: IdempotencyRequest,
    work: () => Promise<T>,
  ): Promise<IdempotencyResult<T>> {
    const id = `${request.scope}:${request.key}`;
    const existing = this.entries.get(id);

    if (existing) {
      if (existing.fingerprint !== request.fingerprint) {
        throw new IdempotencyConflictError();
      }
      return { result: existing.result as T, replayed: true };
    }

    const result = await work();
    this.entries.set(id, { fingerprint: request.fingerprint, result });
    return { result, replayed: false };
  }
}
