# Release checklist

A release ships when every box is ticked. The first block is enforced by CI
(`.github/workflows/ci.yml`); the rest is a human decision.

## Automated gate (CI)

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm build`
- [ ] `pnpm typecheck`
- [ ] `pnpm test` — unit tests
- [ ] `pnpm prisma:migrate` — migrations apply to a fresh database
- [ ] `pnpm prisma:seed` — seed works
- [ ] `pnpm test:integration` — integration tests **and the restore drill**
- [ ] `pnpm test:e2e` — the eight critical journeys of `specs/14`
- [ ] `pnpm test:e2e-three` — the three-end journey (api + mini program + admin)

Locally: `pnpm verify` runs the same steps (lint, build, typecheck, unit,
integration, e2e, three-end).

## Database

- [ ] Every schema change has a committed migration; no manual schema edits
      (`AGENTS.md` §11).
- [ ] The migration is **additive or proven reversible**: a destructive change
      needs a restore path written down before it ships (see
      [`runbook.md`](./runbook.md) §Restore).
- [ ] New or changed queries have the index they need.
- [ ] Migrations deploy **before** the application that requires them, and the
      previous application version keeps working with the new schema
      (expand → migrate → contract).

## Security and privacy (`specs/13`, `specs/10`)

- [ ] No secret in the diff, in a log line or in an environment sample.
- [ ] New or changed endpoints: authenticated, authorized, and tested for
      unauthenticated / wrong-role / wrong-owner / invalid input.
- [ ] Responses remain allowlists — no ORM entity serialization, no new field
      exposing child data, identity documents, internal moderation notes or
      payment secrets.
- [ ] Privileged mutations write an audit row (actor, before/after, request id).
- [ ] Rate limits still cover the expensive routes.

## Money (`specs/08`, `AGENTS.md` §8)

- [ ] Prices, fees and refund amounts are computed server-side; integers in minor
      units; no floating point.
- [ ] Payment callback, refund and order creation remain idempotent.
- [ ] No path lets a client decide an amount or an order status.

## Product rules

- [ ] State machines are unchanged unless the spec changed: orders, provider
      approval, verification, compliance, moderation.
- [ ] Feature flags gate anything that is not V1 default (career marketplace,
      provider-reviews-customer).

## Observability

- [ ] New routes are covered by the metrics/logging described in
      [`monitoring.md`](./monitoring.md).
- [ ] New failure modes have an alert or a runbook entry
      ([`alert-rules.yml`](./alert-rules.yml), [`runbook.md`](./runbook.md)).

## Rollout

- [ ] Rollout plan: instances, order, and the health endpoint that gates traffic
      (`GET /api/v1/health/ready`).
- [ ] Rollback plan written down, including what happens to the migration.
- [ ] After rollout: `/api/v1/health/ready` → `database: up`, one real order
      journey, one login, one admin action audited.

## Sign-off

- [ ] Engineer: diff reviewed, `git diff` checked for accidental secrets or
      unrelated changes.
- [ ] Reviewer: acceptance criteria of the task met.
- [ ] Release owner: this checklist is complete.
