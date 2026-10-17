# Mentor Platform Spec v1.0

> AI-native mentor marketplace: K12 tutoring + university/career mentoring.
> Target implementation: WeChat Mini Program + Admin Web + Modular Monolith API.

## Product decision

- One product, two business domains:
  - `TUTORING`: parents/students find verified university tutors / permitted teachers.
  - `CAREER`: university/graduate students find verified career mentors.
- V1 primary business: tutoring transaction loop.
- Career domain is implemented as a feature-flagged module and can be enabled after tutoring validation.
- Client: WeChat Mini Program.
- Admin: React/Next.js web application.
- Backend: NestJS + TypeScript.
- DB: PostgreSQL.
- Cache/locks: Redis.
- Object storage: S3-compatible OSS/COS.
- Search V1: PostgreSQL indexes/full-text; no Elasticsearch.
- IM: provider abstraction; do not build an IM server in V1.
- Payment: WeChat Mini Program Pay through a payment adapter.
- Architecture: modular monolith; no microservices in V1.

## Repository contract

Read these in order before coding:

1. `AGENTS.md`
2. `specs/00-product-spec.md`
3. `specs/01-business-rules.md`
4. `specs/02-domain-model.md`
5. `specs/03-architecture-spec.md`
6. `specs/04-database-spec.md`
7. `specs/05-api-spec.md`
8. feature-specific specs
9. `implementation/implementation-plan.md`
10. `implementation/task-breakdown.md`

## Operations

Running the platform in production (T024):

1. [`ops/README.md`](ops/README.md) — targets (RPO/RTO), scope, non-negotiables
2. [`ops/backups.md`](ops/backups.md) — backup policy, `ops/backup.sh`, `ops/restore.sh`, the restore drill
3. [`ops/monitoring.md`](ops/monitoring.md) — health probes, structured logs, metrics
4. [`ops/alert-rules.yml`](ops/alert-rules.yml) — alert definitions
5. [`ops/runbook.md`](ops/runbook.md) — procedures for the failures that happen
6. [`ops/incident-response.md`](ops/incident-response.md) — severity, roles, postmortem
7. [`ops/release-checklist.md`](ops/release-checklist.md) — the gate before a release ships

```bash
DATABASE_URL=… PGPASSWORD=… BACKUP_DIR=/var/backups/mentor ops/backup.sh
ops/restore.sh <dump> <scratch-database-url>
```

## Database

Prisma + PostgreSQL. Schema: `prisma/schema.prisma`, migrations: `prisma/migrations`.

```bash
cp .env.example .env            # then set DATABASE_URL / DATABASE_TEST_URL
pnpm prisma:generate            # generate the client
pnpm prisma:migrate             # apply migrations (deploy)
pnpm prisma:seed                # feature flags, admin/test users, taxonomy
pnpm prisma:migrate:dev         # create a new migration after a schema change
```

Integration tests use a **disposable** database (`DATABASE_TEST_URL`); the suite
resets it from the committed migrations before running:

```bash
pnpm test:integration
```

## Auth

`POST /api/v1/auth/wechat/login` exchanges a `wx.login()` code, creating the
account on first login. Access tokens are short-lived JWTs; refresh tokens are
opaque, stored only as hashes and rotated on every use.

```bash
AUTH_PROVIDER=mock   # local/test only — the mock adapter refuses to run in production
AUTH_PROVIDER=wechat # real code2Session (needs WECHAT_APP_ID / WECHAT_APP_SECRET)
```

## Non-negotiable engineering rules

- Spec is the source of truth.
- Do not invent domain behavior not specified here.
- Do not bypass order/payment state machines.
- Do not expose raw ID-card numbers, ID-card images, phone numbers, private addresses, or child identity data to another user unless a later approved spec explicitly requires it.
- Provider approval is separate from identity verification.
- Teacher provider onboarding must have an additional compliance review state.
- Every money operation is idempotent.
- Payment success is confirmed by server-side notification/query, not client callback alone.
- Every privileged admin mutation creates an audit log.
- Every API endpoint must enforce authentication and authorization as specified.
- PII fields must have explicit storage/access classification.
- Tests are part of implementation, not a post-processing step.
