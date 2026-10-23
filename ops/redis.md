# Redis

> Part of `ops/README.md`. What Redis is for, what happens without it, and what
> an operator has to know before running more than one instance (T034).

## What it is used for

Exactly two things, both of them shared state between instances:

| Use           | Key                                                       | Mechanism                                 | TTL                 |
| ------------- | --------------------------------------------------------- | ----------------------------------------- | ------------------- |
| Rate limiting | `mentor:rate-limit:<scope>:<key>`                         | `INCR` + `EXPIRE` on creation             | the policy's window |
| Idempotency   | `mentor:idempotency:<scope>:<key>` (claim) and `…:result` | `SET NX EX` claim, then the stored answer | 24 h                |

Nothing else. There is no cache to invalidate and no queue: sessions, orders and
money live in PostgreSQL, and the document store holds the objects.

## What happens without it

`REDIS_URL` unset (or set to `disabled`) means **no Redis**, and the platform
degrades rather than fails:

- rate-limit counters become per-instance (`InMemoryRateLimiter`);
- idempotency keys become per-instance (`InMemoryIdempotencyStore`);
- both are logged once at boot or on the first fallback, not per request.

That is correct for **exactly one instance**. Two instances without Redis give
every client twice the rate-limit budget and can apply an idempotent command
twice — which is why a multi-instance deployment must point `REDIS_URL` at a
reachable server.

## What happens when it fails

A Redis outage is not an outage of the platform:

- commands are not queued (`enableOfflineQueue: false`), so a call fails now
  instead of hanging;
- the retry budget is short (`maxRetriesPerRequest: 2`, give up after ~3
  attempts), so a deployment settles into "no Redis" instead of reconnecting
  forever;
- each failure logs a warning and falls back for that request;
- `/health/ready` still reports the database only — Redis is an accelerator, not
  a dependency of correctness for a single instance.

## Running it

```bash
# Local (single instance, Redis optional)
REDIS_URL=redis://localhost:6379   # or leave unset to use in-process stores

# Multi-instance: every instance points at the same server
REDIS_URL=rediss://cache.internal:6380
```

There is no secret in `REDIS_URL` beyond the credential itself: keep it in the
environment (or the secret manager), never in the repository.

## Verifying it is in use

1. Start the API with `REDIS_URL` set and run two requests that trip a limit; the
   second instance (or a restart) must see the same counter.
2. `redis-cli --scan --pattern 'mentor:*'` — keys appear only while a window or a
   claim is live.
3. Stop Redis: the platform keeps serving, logs a fallback warning, and no
   request fails because of Redis.

## Not covered yet

- Redis is not used for distributed locks (the availability claim is a
  transactional PostgreSQL update, T011) — deliberately, because a lock that can
  expire mid-work is worse than a database transaction.
- No Redis-backed cache: every read still goes to PostgreSQL.
- No cluster or sentinel topology tested; a single endpoint is assumed.
