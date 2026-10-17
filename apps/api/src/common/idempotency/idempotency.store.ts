/**
 * Idempotency for write operations that must not repeat
 * (`specs/03-architecture-spec.md` §Idempotency: order, payment, refund,
 * settlement).
 *
 * A key is scoped (the operation) and carries a fingerprint of the request: the
 * same key with a different payload is a conflict, never a silent replay.
 */
export const IDEMPOTENCY_STORE = 'IDEMPOTENCY_STORE';

export interface IdempotencyRequest {
  /** The operation, e.g. `orders.create`. */
  scope: string;
  /** The client-supplied `Idempotency-Key`. */
  key: string;
  /** Serialization of the payload; it must not change between retries. */
  fingerprint: string;
}

export interface IdempotencyResult<T> {
  result: T;
  /** `true` when the stored answer of a previous call was replayed. */
  replayed: boolean;
}

export interface IdempotencyStore {
  /**
   * Run `work` at most once per (scope, key).
   *
   * A failed `work` stores nothing, so a retry runs it again.
   */
  runOnce<T>(request: IdempotencyRequest, work: () => Promise<T>): Promise<IdempotencyResult<T>>;
}

/**
 * Same key, different payload: refuse instead of replaying an unrelated answer.
 *
 * `specs/05-api-spec.md` defines `IDEMPOTENCY_CONFLICT` (409) for exactly this.
 */
export class IdempotencyConflictError extends Error {
  constructor(message = 'This idempotency key was already used with a different request.') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}
