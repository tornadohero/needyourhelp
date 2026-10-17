#!/usr/bin/env bash
#
# Backup the PostgreSQL database of the Mentor Platform (T024).
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/mentor ops/backup.sh
#
# Produces, for every run:
#
#   mentor-<UTC timestamp>.dump     custom-format dump (compressed, restorable
#                                   with `pg_restore`, supports --clean)
#   mentor-<UTC timestamp>.dump.sha256
#
# Rules this script follows:
#   - the database password never appears in the process list: it is taken from
#     `PGPASSWORD` (or from `DATABASE_URL`, then exported into the environment)
#     and `pg_dump` is called with host/port/user/database arguments only;
#   - the connection string is never echoed, even on failure;
#   - a run either leaves a dump whose checksum verifies, or fails loudly;
#   - old dumps are pruned by `RETENTION_DAYS` (default 30).
#
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup: DATABASE_URL is required" >&2
  exit 2
fi

if ! command -v "$PG_DUMP_BIN" >/dev/null 2>&1; then
  echo "backup: $PG_DUMP_BIN not found (set PG_DUMP_BIN)" >&2
  exit 2
fi

# --- connection -------------------------------------------------------------
# postgresql://user[:password]@host[:port]/database[?query]
rest="${DATABASE_URL#*://}"
userpass="${rest%%@*}"
hostport_db="${rest#*@}"

DB_USER="${userpass%%:*}"
if [[ "$userpass" == *:* ]]; then
  DB_PASSWORD="${userpass#*:}"
else
  DB_PASSWORD="${PGPASSWORD:-}"
fi
DB_PASSWORD="${DB_PASSWORD%%\?*}"
DB_PASSWORD="${DB_PASSWORD//\%/\\x}" # not decoded: pass through, warn below

hostport="${hostport_db%%/*}"
dbname="${hostport_db#*/}"
dbname="${dbname%%\?*}"

DB_HOST="${hostport%%:*}"
if [[ "$hostport" == *:* ]]; then
  DB_PORT="${hostport#*:}"
else
  DB_PORT="5432"
fi

if [[ "$DB_PASSWORD" == *\\x* ]]; then
  echo "backup: URL-escaped password detected — set PGPASSWORD instead" >&2
  exit 2
fi

export PGPASSWORD="$DB_PASSWORD"

# --- dump -------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/mentor-$stamp.dump"

# `--format=custom` is the only format `pg_restore` can restore selectively and
# out of order; it is compressed, so no second compression step is needed.
# `--no-owner`/`--no-privileges` keep the dump restorable as another role.
"$PG_DUMP_BIN" \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$dbname" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$dump"

if [[ ! -s "$dump" ]]; then
  echo "backup: dump is empty — refusing to publish it" >&2
  exit 1
fi

# --- checksum ---------------------------------------------------------------
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$dump")" >"$dump.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$dump")" >"$dump.sha256")
else
  echo "backup: no sha256 tool found — checksum skipped" >&2
fi

if [[ -f "$dump.sha256" ]]; then
  (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$dump.sha256")" >/dev/null 2>&1 ||
    shasum -a 256 -c "$(basename "$dump.sha256")" >/dev/null 2>&1)
fi

# --- retention --------------------------------------------------------------
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -type f -name 'mentor-*.dump*' -mtime "+${RETENTION_DAYS}" -print -delete || true
fi

echo "$dump"
