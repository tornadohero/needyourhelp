#!/usr/bin/env bash
#
# Restore a Mentor Platform backup and verify it (T024: restore test).
#
#   ops/restore.sh <dump-file> <target-database-url>
#
# The target database is created if it does not exist, so the normal use is a
# scratch database: restore there, verify there, and only then decide whether the
# dump is good enough to be called a backup.
#
# Verification never trusts that `pg_restore` exited 0: it counts what came back
# and fails if the platform's tables are missing or the database is empty.
#
set -euo pipefail

DUMP_FILE="${1:-}"
TARGET_URL="${2:-}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
PSQL_BIN="${PSQL_BIN:-psql}"

if [[ -z "$DUMP_FILE" || -z "$TARGET_URL" ]]; then
  echo "usage: ops/restore.sh <dump-file> <target-database-url>" >&2
  exit 2
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "restore: no such dump: $DUMP_FILE" >&2
  exit 2
fi

for bin in "$PG_RESTORE_BIN" "$PSQL_BIN"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "restore: $bin not found" >&2
    exit 2
  fi
done

# --- checksum ---------------------------------------------------------------
if [[ -f "$DUMP_FILE.sha256" ]]; then
  (cd "$(dirname "$DUMP_FILE")" &&
    (sha256sum -c "$(basename "$DUMP_FILE.sha256")" >/dev/null 2>&1 ||
      shasum -a 256 -c "$(basename "$DUMP_FILE.sha256")" >/dev/null 2>&1)) ||
    {
      echo "restore: checksum does not match — do not use this dump" >&2
      exit 1
    }
  echo "restore: checksum verified"
fi

# --- connection -------------------------------------------------------------
rest="${TARGET_URL#*://}"
userpass="${rest%%@*}"
hostport_db="${rest#*@}"

DB_USER="${userpass%%:*}"
DB_PASSWORD="$userpass"
if [[ "$userpass" == *:* ]]; then
  DB_PASSWORD="${userpass#*:}"
else
  DB_PASSWORD="${PGPASSWORD:-}"
fi
DB_PASSWORD="${DB_PASSWORD%%\?*}"

hostport="${hostport_db%%/*}"
dbname="${hostport_db#*/}"
dbname="${dbname%%\?*}"

DB_HOST="${hostport%%:*}"
if [[ "$hostport" == *:* ]]; then
  DB_PORT="${hostport#*:}"
else
  DB_PORT="5432"
fi

export PGPASSWORD="$DB_PASSWORD"

psql_base=("$PSQL_BIN" --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --no-password -v ON_ERROR_STOP=1)

# --- create the target ------------------------------------------------------
if ! "${psql_base[@]}" --dbname="$dbname" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "restore: creating database $dbname"
  "${psql_base[@]}" --dbname=postgres -c "CREATE DATABASE \"$dbname\"" >/dev/null
fi

# --- restore ----------------------------------------------------------------
# `--clean --if-exists` makes a restore into an existing database repeatable,
# which is what a restore drill needs.
"$PG_RESTORE_BIN" \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$dbname" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --exit-on-error \
  "$DUMP_FILE"

# --- verify -----------------------------------------------------------------
tables="$("${psql_base[@]}" --dbname="$dbname" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"

if [[ -z "$tables" || "$tables" -eq 0 ]]; then
  echo "restore: no tables were restored" >&2
  exit 1
fi

for table in users orders payments refunds reviews taxonomy_terms; do
  rows="$("${psql_base[@]}" --dbname="$dbname" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$table'")"
  if [[ "$rows" != "1" ]]; then
    echo "restore: table $table is missing from the restored database" >&2
    exit 1
  fi
done

migrations="$("${psql_base[@]}" --dbname="$dbname" -tAc \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo 0)"

echo "restore: ok — tables=$tables migrations=$migrations"
echo "restore: database '$dbname' restored from $DUMP_FILE"
