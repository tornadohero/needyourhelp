# Monitoring

`specs/03-architecture-spec.md` asks for structured logs, latency metrics, DB
query metrics, payment callback metrics, order conversion metrics and the audit
log. This is what the platform exposes and what to watch.

## Probes

| Endpoint                   | Meaning                                      | Failure behaviour                       |
| -------------------------- | -------------------------------------------- | --------------------------------------- |
| `GET /api/v1/health`       | Liveness — the process answers               | Restart the container                   |
| `GET /api/v1/health/ready` | Readiness — the process can reach PostgreSQL | Take the instance out of the pool; page |

`GET /api/v1/health/ready` answers:

```json
{
  "data": {
    "status": "ok",
    "service": "api",
    "database": "up",
    "databaseLatencyMs": 2,
    "env": "production",
    "time": "…"
  }
}
```

It exposes **one bit** about the database — up or down — and nothing about where
the database is: no host, no version, no connection string, no row counts. It
fails closed: when the database does not answer, the probe returns `503`, so a
load balancer and an alert both do the right thing without interpreting a body.

Probes are exempt from meaningful rate limiting (`health.probe` policy): a probe
throttled by the service it is watching turns into a false alarm.

Point liveness at `/api/v1/health` and readiness at `/api/v1/health/ready`. Do not
alert on liveness alone — a process that is up but cannot reach its database is
the failure users notice.

## Structured logs

Every request writes one JSON line from the `access` logger:

```json
{
  "kind": "access",
  "requestId": "…",
  "method": "POST",
  "path": "/api/v1/orders",
  "status": 201,
  "durationMs": 41.2,
  "ipHash": "…"
}
```

Deliberately absent: the query string (private-object URLs carry signatures,
search URLs carry PII), headers, cookies, bodies, tokens, raw IP addresses (the
address is hashed with the same helper the audit log uses) and — per
`specs/13-security-spec.md` §Logging — passwords, ID-card numbers, identity
documents, message contents and full child profiles.

Probe traffic is not logged: it is the noisiest and least informative traffic on
the platform.

Business events are logged by the analytics sink (T020) and, for privileged
actions, written to `audit_logs` (`GET /admin/audit-logs`).

## Metrics to collect

| Signal                              | Source                                | Why                                              |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------ |
| Request rate and status class       | access log                            | The base of everything else                      |
| p50/p95/p99 latency per route       | access log                            | Latency is the first symptom                     |
| 5xx ratio                           | access log                            | Page on this, not on CPU                         |
| Readiness result                    | probe                                 | Database reachability                            |
| `databaseLatencyMs`                 | probe payload                         | Creeping DB latency precedes an outage           |
| DB connections / slow queries       | PostgreSQL                            | The usual cause                                  |
| Payment callback count and failures | `POST /api/v1/payments/wechat/notify` | Silent money loss                                |
| Orders created vs paid vs completed | `orders` table                        | Conversion, and stalled funnels                  |
| Refunds initiated and failed        | `refunds` table                       | Money moving out                                 |
| Moderation cases open and aged      | `moderation_cases`                    | Duty of care, not just uptime                    |
| Rate-limit rejections (429)         | access log                            | Abuse or a misconfigured client                  |
| Audit log write volume              | `audit_logs`                          | A privileged action happened; check it was yours |

## Dashboards

1. **Traffic and errors** — request rate, status classes, p95 per route.
2. **Money** — payment sessions, callbacks, orders paid, refunds, failures.
3. **Trust** — applications submitted, verifications decided, moderation cases
   open, teacher compliance pending.
4. **Platform** — readiness, DB latency, connections, disk, backup age.

## Backup monitoring

Alert on the **age of the newest dump**, not only on job exit status: a scheduler
that stopped running produces no failure. Also alert when the restore drill is
skipped on a production runner for more than one run — see
[`backups.md`](./backups.md) §Restore test.
