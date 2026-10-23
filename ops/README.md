# Operations

How the Mentor Platform is kept running once it is running (T024).

| Document                                         | What it is for                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`backups.md`](./backups.md)                     | What is backed up, how often, how long it is kept, and how a restore is performed |
| [`monitoring.md`](./monitoring.md)               | What to watch: health probes, structured logs, the metrics that matter            |
| [`alert-rules.yml`](./alert-rules.yml)           | The alert definitions, in Prometheus rule format                                  |
| [`runbook.md`](./runbook.md)                     | Step-by-step procedures for the failures that actually happen                     |
| [`incident-response.md`](./incident-response.md) | Severity, roles, communications, postmortem                                       |
| [`release-checklist.md`](./release-checklist.md) | The gate a release has to pass before it ships                                    |

Scripts:

| Script                       | What it does                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| [`backup.sh`](./backup.sh)   | Dump the database (custom format), checksum it, prune by retention        |
| [`restore.sh`](./restore.sh) | Restore a dump into a database — by default a scratch one — and verify it |

## Targets

| Target           | Value                     | Why                                                                                      |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| RPO (data loss)  | ≤ 15 minutes              | Hourly logical dumps plus WAL; a payment callback that never landed is money             |
| RTO (downtime)   | ≤ 60 minutes              | Restore is verified every time the pipeline runs; the slow part is DNS, not `pg_restore` |
| Backup retention | 30 days daily, 12 monthly | `specs/10`: personal data must not be kept forever                                       |
| Restore drill    | Every CI run              | A backup that has never been restored is a guess                                         |

## Scope

PostgreSQL is the only stateful component: orders, payments, refunds, reviews,
children, consents, verification cases and audit logs all live there. Redis holds
cache, idempotency keys and short-lived locks and is **reconstructible** — it is
not backed up, and a cold cache must never change behaviour. Object storage holds
verification documents and is the second thing to restore; it is versioned and
encrypted by the provider, and its object keys are in the database.

## Non-negotiables

- Secrets come from the environment or a secret manager and never from a file in
  this repository (`AGENTS.md` §9). Backup scripts read the connection string from
  the environment and never echo it.
- A restore is only "done" when `ops/restore.sh` says `restore: ok` **and** the
  application answers `GET /api/v1/health/ready` with `database: up`.
- An incident writes to the audit log too: privileged actions taken during an
  incident are audited like any other (`AGENTS.md` §13).

- [`ops/redis.md`](redis.md) — Redis: usage, fallback, multi-instance requirement
