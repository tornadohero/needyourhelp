# Backups

## What is backed up

| Data                              | Where          | Method                                              | Recoverable?    |
| --------------------------------- | -------------- | --------------------------------------------------- | --------------- |
| All platform tables               | PostgreSQL     | `pg_dump --format=custom` (`ops/backup.sh`)         | Yes             |
| WAL                               | PostgreSQL     | Continuous archiving (managed service)              | Point-in-time   |
| Verification documents, avatars   | Object storage | Provider-side versioning + cross-region replication | Yes             |
| Redis (cache, idempotency, locks) | Redis          | Not backed up                                       | Reconstructible |
| Secrets                           | Secret manager | Managed, versioned                                  | Yes             |

Redis is deliberately excluded: it holds a cache, idempotency keys with a
short TTL and short-lived locks. Restoring stale idempotency keys would be worse
than losing them — a payment callback is idempotent at the database level too
(`specs/03` §Idempotency).

## Schedule

| Layer                    | Cadence                                         | Retention                   |
| ------------------------ | ----------------------------------------------- | --------------------------- |
| Logical dump             | hourly during business hours, nightly otherwise | 30 days                     |
| Daily snapshot (managed) | nightly                                         | 30 days                     |
| Monthly archive          | 1st of the month                                | 12 months                   |
| WAL archive              | continuous                                      | covers the retention window |

Retention is not only cost: `specs/10-privacy-and-minors.md` requires personal
data — children, consents, identity documents — to stop existing when it is no
longer needed. Restoring a backup older than the retention window is therefore a
decision, not a routine.

## Backing up

```bash
export DATABASE_URL='postgresql://…'          # from the secret manager
export PGPASSWORD='…'                          # preferred: never in the URL
export BACKUP_DIR=/var/backups/mentor          # default: ./backups
export RETENTION_DAYS=30                       # 0 disables pruning

ops/backup.sh
```

The script:

1. resolves `pg_dump` (override with `PG_DUMP_BIN`);
2. passes host/port/user/database only — the password travels in `PGPASSWORD`, so
   it never appears in the process list;
3. writes `mentor-<UTC timestamp>.dump` and its `.sha256`;
4. verifies the checksum it just wrote and refuses to publish an empty dump;
5. prunes dumps older than `RETENTION_DAYS`;
6. prints the path of the dump it produced.

Schedule it (cron):

```cron
0 * * * * DATABASE_URL=… PGPASSWORD=… BACKUP_DIR=/var/backups/mentor ops/backup.sh >> /var/log/mentor-backup.log 2>&1
```

Encrypt off-host copies before they leave the host (`age`/`gpg`, key in the
secret manager) and store them in a different failure domain from the database.
The dump contains personal data: children, consents, hashed IP addresses.

## Restoring

Always into a scratch database first:

```bash
ops/restore.sh /var/backups/mentor/mentor-20261003T062932Z.dump \
  'postgresql://user@localhost:5432/mentor_restore_check'
```

`ops/restore.sh`:

1. verifies the checksum and refuses a dump that does not match;
2. creates the target database if it does not exist;
3. `pg_restore --clean --if-exists --exit-on-error`;
4. counts the tables and fails if `users`, `orders`, `payments`, `refunds`,
   `reviews` or `taxonomy_terms` are missing;
5. prints `restore: ok — tables=… migrations=…`.

Then point the application at the restored database and confirm:

```bash
curl -s http://localhost:3000/api/v1/health/ready
# {"data":{"status":"ok","service":"api","database":"up", …}}
```

Only then decide whether the restored database becomes production
(see [`runbook.md`](./runbook.md) §Restore).

## Restore test

`apps/api/test/integration/backup-restore.spec.ts` runs the whole loop with the
real scripts — dump, checksum, restore into a scratch database, compare every
table's row count, drop the scratch database — and is part of
`pnpm test:integration`, so **every CI run performs a restore drill**.

It skips (with a warning) when the host has no `pg_dump`/`pg_restore`/`psql`, or
when the client is older than the server. A skip is an environment fact, not a
pass: on production runners the binaries must be present.
