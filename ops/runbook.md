# Runbook

Procedures for the failures that actually happen. Every procedure starts with
**what you will see** and ends with **how you know it is fixed**.

Before anything else: state the incident in one sentence in the incident channel
and set a severity ([`incident-response.md`](./incident-response.md)). Silence is
the failure mode that turns an outage into a story.

---

## API down

**See**: `ApiDown` (instance not answering `/api/v1/health`), 5xx or timeouts.

1. Is it one instance or all of them? One → take it out of the pool, keep it for
   logs; all → treat as a platform incident.
2. `docker logs`/journal for the last minutes: a crash loop shows a stack trace,
   usually a failed migration, a missing secret or an exhausted port.
3. If the process restarted: check whether the last release changed environment
   variables.
4. Roll back if the last deploy is inside the suspect window
   ([release-checklist.md](./release-checklist.md) §Rollback).

**Fixed when**: `/api/v1/health` answers `status: ok` on every instance.

---

## Database unreachable

**See**: `DatabaseUnreachable`, `GET /api/v1/health/ready` → `503`, every write
failing.

1. Confirm from two places (application log + `psql`): distinguish "database is
   down" from "application cannot reach it" (credentials, network, security
   group, pooler).
2. Check connections: `SELECT count(*) FROM pg_stat_activity;` — an exhausted
   pool looks like an outage.
3. If it is the managed service, follow its failover path; do not promote a
   replica by hand unless the provider's procedure says so.
4. After recovery: verify the audit log has no gap during the window
   (`GET /admin/audit-logs`), and re-check orders that were mid-payment.

**Fixed when**: `/api/v1/health/ready` answers `database: up`, and a payment
session can be created end to end.

---

## Payment callbacks failing

**See**: `PaymentCallbackFailures`, orders stuck in `PENDING_PAYMENT`.

1. Check whether the gateway can reach us: callback URL, TLS certificate, and
   whether a deploy changed the raw-body handling (`main.ts` passes `rawBody` —
   the WeChat signature covers the exact bytes; re-serialising the body breaks
   every callback).
2. Look for callbacks rejected because of an amount mismatch: that is the
   tamper guard working, not a bug — but a client sending the wrong amount is
   worth a look.
3. Re-deliver from the gateway console if it supports it; the callback is
   idempotent, so a retry cannot double-charge
   (`apps/api/test/integration/backup-restore.spec.ts`'s siblings cover replay).
4. If an order must be closed by hand: an administrator issues the refund or the
   order command through the admin routes — every one of them is audited, and
   nothing should be fixed with SQL.

**Fixed when**: a test order reaches `PAID` through a real callback.

---

## Refund stuck

**See**: `RefundFailures`, `StuckRefundBranch` (orders in `REFUND_PENDING`).

1. Is the refund `PROCESSING` at the gateway? The platform records the gateway's
   answer and does not poll it; check the gateway console for the final state.
2. A failed refund leaves the order in `REFUND_PENDING` on purpose: the money is
   still with us. Re-issue the admin refund command with the same
   `Idempotency-Key` — it returns the same refund row instead of creating money
   twice.
3. Never "fix" a refund by editing `refunds`, `payments` or `orders` with SQL:
   the amount the server refunds is derived from what was captured, and an
   unaudited edit is worse than a stuck refund.

**Fixed when**: the refund row is `SUCCEEDED`, the order is `REFUNDED`, and the
audit log holds one `REFUND_INITIATED` row for it.

---

## Backup missing

**See**: `BackupTooOld`, `BackupFailed`.

1. Is the scheduler alive? A cron that stopped produces no failure.
2. Run a backup by hand and watch the exit status:
   `BACKUP_DIR=… DATABASE_URL=… ops/backup.sh`.
3. If disk is full, free space before the next run; an empty dump is refused by
   the script rather than published.
4. Verify the newest dump restores: `ops/restore.sh <dump> <scratch-url>`.

**Fixed when**: a fresh dump exists, its checksum verifies, and the restore drill
says `restore: ok`.

---

## Restore drill skipped

**See**: `RestoreDrillSkipped`.

The drill skips when `pg_dump`/`pg_restore`/`psql` are missing, or when the
client is older than the server. That is an environment fact, not a pass: install
matching client binaries on the runner so the drill actually runs. A skipped
drill means the last backup is unverified.

---

## Restore

Restore is a decision with a data-loss consequence, so it is done in a scratch
database first.

1. Choose the dump: newest verified one, or the point-in-time target if the loss
   window is narrower than the dump cadence.
2. `ops/restore.sh <dump> 'postgresql://…/mentor_restore_check'`.
3. Compare the scratch database with production: row counts per table, the newest
   order, the newest payment, the newest audit row. A restore that loses rows is
   not a restore.
4. Decide the loss window and say it out loud in the incident channel.
5. Point the application at the restored database, then check
   `/api/v1/health/ready` and one real order journey.
6. Keep the old database until the postmortem is written.

**Fixed when**: the application answers readiness `database: up` against the
restored database and a full order journey succeeds.

---

## Database slow

**See**: `DatabaseSlowQueries`, `HighLatency`, rising `databaseLatencyMs`.

1. Identify the query from `pg_stat_statements`.
2. Check whether a new release introduced it (N+1 is the usual suspect;
   `AGENTS.md` §6 forbids it).
3. Short term: kill the runaway query, or lower load. Long term: index with a
   migration — never edit the production schema by hand (`AGENTS.md` §11).

---

## Database connections exhausted

**See**: `DatabaseConnectionsHigh`, then timeouts everywhere.

1. `SELECT state, count(*) FROM pg_stat_activity GROUP BY state;` — idle-in-
   transaction means a leaked transaction; find the oldest.
2. Reduce instance count or raise the pool limit in front of the database.
3. Restart the API only after identifying the cause, or it will fill up again.

---

## Moderation backlog

**See**: `ModerationBacklog`, `AgedModerationCase`.

Trust and safety is an availability problem too: an unhandled report is a user
left in harm's way. Work the queue with `GET /admin/reports`, escalate to
`specs/12-admin-spec.md` actions, and remember an appeal must be reviewed by a
**different** administrator than the one who decided the case.

---

## Verification backlog

**See**: `VerificationBacklog`.

Providers cannot be approved while their cases sit unworked, so the marketplace
stops growing. Work `GET /admin/verifications`; decisions are audited and must
carry a reason code.

---

## Rate-limit spike

**See**: `RateLimitRejectionsSpike`.

1. Which policy fired? (`auth.login`, `search.public`, `payments.session`,
   `reports.create`, …).
2. Legitimate traffic from one address behind NAT → adjust the client, not the
   limit.
3. Abuse → block at the edge; the platform already limits per account where the
   action is expensive.

---

## Credential stuffing

**See**: `LoginFailuresSpike`.

1. Confirm the failures are spread over many accounts (not one user).
2. Block at the edge; `auth.login` is limited per address.
3. Watch for successful logins from the same address afterwards; if any, treat as
   a security incident and follow
   [`incident-response.md`](./incident-response.md) §Containment.

---

## Secret rotation

1. Rotate in the secret manager, then deploy — never commit a secret
   (`AGENTS.md` §9).
2. Access/refresh token secrets: rotating revokes every session. Announce it.
3. Payment/IM/object-storage credentials: rotate in the provider console first,
   then in the environment, then deploy; verify with one real payment session and
   one signed upload URL.

---

## Deploy

See [`release-checklist.md`](./release-checklist.md). In short: migrations deploy
before the application that needs them, the application is rolled out, and
`/api/v1/health/ready` is checked before traffic is switched back on.

## Rollback

1. Roll the application back to the previous image.
2. If the release contained a destructive migration, **do not** roll the database
   back blindly: restore from the newest verified dump into a scratch database,
   compare, and only then decide (§Restore).
3. Re-run the smoke journey after the rollback.
