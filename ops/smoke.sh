#!/usr/bin/env bash
#
# Post-deploy smoke test (T036).
#
# The smallest set of checks that prove a deployment is alive and connected:
# the process answers, the database answers, and a session can be created with
# the configured auth provider. Everything here is read-only (the login probe
# creates a throwaway account only when ASK_LOGIN=1, and never touches an
# existing one).
#
# Usage:
#   API_BASE_URL=https://api.example.com ops/smoke.sh
#   API_BASE_URL=http://127.0.0.1:3000 ASK_LOGIN=1 ops/smoke.sh
#
# Exit codes: 0 all checks passed, 1 a check failed, 2 usage error.
set -uo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
API="${API_BASE_URL%/}/api/v1"
ASK_LOGIN="${ASK_LOGIN:-0}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-1}"
SLEEP_SECONDS="${SLEEP_SECONDS:-5}"

failures=0

log() { printf '%-8s %s\n' "$1" "$2"; }

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    log "ok" "$name ($actual)"
  else
    log "FAIL" "$name (expected $expected, got $actual)"
    failures=$((failures + 1))
  fi
}

http_status() {
  local method="$1" url="$2"
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$method" "$url" || echo 000
}

body_of() {
  local method="$1" url="$2"
  curl -s --max-time 10 -X "$method" "$url" || true
}

wait_for_ready() {
  local attempt=1
  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    if [ "$(http_status GET "$API/health/ready")" = "200" ]; then
      return 0
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -le "$MAX_ATTEMPTS" ] && sleep "$SLEEP_SECONDS"
  done
  return 1
}

# 1. The process answers.
check "GET /health" 200 "$(http_status GET "$API/health")"

# 2. The database answers — this is the probe that gates traffic.
if ! wait_for_ready; then
  log "FAIL" "GET /health/ready did not become 200 in $MAX_ATTEMPTS attempt(s)"
  failures=$((failures + 1))
else
  ready_body="$(body_of GET "$API/health/ready")"
  if printf '%s' "$ready_body" | grep -q '"database":"up"'; then
    log "ok" "GET /health/ready (database: up)"
  else
    log "FAIL" "GET /health/ready without database: up -> $ready_body"
    failures=$((failures + 1))
  fi
fi

# 3. A session can be created with the configured provider (mock only: a real
#    WeChat code cannot be minted by a script).
if [ "$ASK_LOGIN" = "1" ]; then
  login_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST "$API/auth/wechat/login" \
    -H 'content-type: application/json' \
    -d '{"code":"smoke-probe"}')"
  check "POST /auth/wechat/login" 201 "$login_status"
else
  log "skip" "POST /auth/wechat/login (set ASK_LOGIN=1 to probe; mock provider only)"
fi

if [ "$failures" -gt 0 ]; then
  printf '\nsmoke: %d check(s) failed\n' "$failures"
  exit 1
fi

printf '\nsmoke: ok\n'
