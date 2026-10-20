/**
 * Rate limiting (`specs/13-security-spec.md` §API: "rate limiting",
 * §Abuse prevention).
 *
 * A limiter answers one question — may this caller do this now — and never knows
 * what the action is. The policies live here, in one place, so the same numbers
 * can be moved to a shared store (Redis) without touching a single route.
 */

/** Dependency-injection token for {@link RateLimiter}. */
export const RATE_LIMITER = 'RATE_LIMITER';

/** A named limit. `scope` decides what the counter is keyed on. */
export interface RateLimitPolicy {
  /** How many actions are allowed inside `windowSeconds`. */
  limit: number;
  windowSeconds: number;
  /** `account` limits a signed-in user; `ip` limits the caller's address. */
  scope: 'account' | 'ip';
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the caller may try again; `0` when allowed. */
  retryAfterSeconds: number;
  /** The limit that was applied, for the `RateLimit-Limit` header. */
  limit: number;
  /** What remained before this call, for `RateLimit-Remaining`. */
  remaining: number;
}

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}

/**
 * The policies of the platform.
 *
 * The numbers are deliberately stricter where an action costs the platform
 * money, reputation or an identity document, and looser where it is a read.
 */
export const RATE_LIMIT_POLICIES = {
  /** Login is the one unauthenticated write: brute force starts here. */
  'auth.login': { limit: 10, windowSeconds: 60, scope: 'ip' },
  /** Expensive read that any anonymous caller can trigger. */
  'search.public': { limit: 120, windowSeconds: 60, scope: 'ip' },
  /**
   * The admin console is a password: brute force here is worth the most.
   * (Account-side counting is on top of this, in the credential lockout.)
   */
  'auth.console': { limit: 5, windowSeconds: 60, scope: 'ip' },
  /** A provider application starts an identity review: keep it rare. */
  'applications.create': { limit: 5, windowSeconds: 3_600, scope: 'account' },
  /** Each payment session is a gateway call and an order attempt. */
  'payments.session': { limit: 20, windowSeconds: 3_600, scope: 'account' },
  /** Reviews move a provider's reputation. */
  'reviews.create': { limit: 10, windowSeconds: 86_400, scope: 'account' },
  /** Messages are the abuse vector inside a conversation (`specs/09`). */
  'messages.send': { limit: 60, windowSeconds: 60, scope: 'account' },
  /** Reports open a moderation case. */
  'reports.create': { limit: 20, windowSeconds: 86_400, scope: 'account' },
  /** Conversations are the message-abuse vector of `specs/09`. */
  'conversations.create': { limit: 30, windowSeconds: 3_600, scope: 'account' },
  /**
   * Health probes: cheap, frequent and unauthenticated. A probe that is
   * throttled by the platform it is watching turns into a false alarm (T024).
   */
  'health.probe': { limit: 6_000, windowSeconds: 60, scope: 'ip' },
  /** Everything else: a generous per-address ceiling. */
  default: { limit: 300, windowSeconds: 60, scope: 'ip' },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export function policyFor(name: string): RateLimitPolicy {
  return (
    (RATE_LIMIT_POLICIES as Record<string, RateLimitPolicy>)[name] ?? RATE_LIMIT_POLICIES.default
  );
}
