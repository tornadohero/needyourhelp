# AGENTS.md — CodeBuddy execution contract

## Mission

You are implementing Mentor Platform from the repository specs. Your job is to execute approved tasks, not redesign the product.

## Before every task

1. Read this file.
2. Read the task file.
3. Read all referenced specs.
4. Inspect current implementation and tests.
5. Identify impacted modules, DB tables, APIs and UI.
6. If the task conflicts with a spec, STOP and report the conflict. Do not silently reinterpret it.

## Architecture constraints

- Backend: NestJS + TypeScript.
- Database: PostgreSQL + Prisma ORM.
- Redis: caching, idempotency, short-lived locks.
- Frontend: WeChat Mini Program with TypeScript; use a consistent component/design system.
- Admin: Next.js + TypeScript.
- API style: REST JSON under `/api/v1`.
- Validation: DTO/schema validation at API boundary.
- Auth: WeChat login -> server-issued access/refresh session.
- Authorization: RBAC + resource ownership.
- Money: integer minor units (`amountFen`, `amountCent`), never floating point.
- Time: UTC in DB; API timestamps ISO-8601; display in configured user timezone.
- IDs: UUID/ULID; never expose sequential DB IDs as public identifiers.
- Soft delete where business history must be preserved.
- Audit log for admin, verification, payment, refund, settlement, moderation and permission changes.

## Coding rules

- Small modules, explicit dependencies, no circular dependencies.
- Domain rules live in domain/application services, not controllers.
- Controllers only authenticate, validate, invoke use cases and map responses.
- Repositories abstract persistence.
- External providers use adapters/interfaces.
- Never call payment/IM/storage SDKs directly from domain logic.
- Never trust client-provided price, provider approval, role, order status, user ID, or permission.
- Server recalculates all prices and authorization.
- Use transactions for state changes that must be atomic.
- Use idempotency keys for create-order, payment callback, refund and settlement operations.
- Avoid N+1 queries.
- Add DB indexes based on query patterns in the DB spec.

## Security rules

- Secrets only via environment/secret manager.
- Never log passwords, tokens, ID-card numbers, raw identity documents, payment secrets or message contents unless a specific redacted audit requirement exists.
- Encrypt sensitive data at rest where supported.
- Signed URLs for private files.
- File uploads require type/size validation and malware/content checks where infrastructure supports it.
- Rate-limit authentication, messaging, verification, payment and public search APIs.
- All admin APIs require admin role and audit logging.
- Do not expose internal moderation notes to normal users.

## Product rules

- V1 tutoring is the default enabled marketplace.
- Career marketplace is feature-flagged.
- Provider must be approved before being discoverable or orderable.
- A user may have multiple roles.
- One person may have multiple provider capabilities, but each capability has its own verification/status.
- Child profile belongs to a parent/guardian account.
- Child data is minimized and is not public.
- Reviews are tied to completed orders.
- No review manipulation: one review per eligible order unless an approved edit flow exists.
- Provider and customer may not exchange direct contact information in public profile fields.
- IM must support report/block/moderation hooks.

## Task completion checklist

Before marking a task done:

- [ ] Code compiles/type-checks.
- [ ] Unit tests pass.
- [ ] Integration tests pass if affected.
- [ ] API contract updated if API changed.
- [ ] DB migration created if schema changed.
- [ ] Seed data updated if needed.
- [ ] UI states include loading/empty/error/permission states.
- [ ] Security/authorization tests exist for protected operations.
- [ ] Audit logs exist for privileged mutations.
- [ ] README/spec references updated if behavior changed.
- [ ] `git diff` reviewed for accidental secrets or unrelated changes.

## Git discipline

One logical task = one commit when practical.

Commit format:
`feat(scope): ...`
`fix(scope): ...`
`test(scope): ...`
`chore(scope): ...`
`docs(scope): ...`

Do not squash unrelated work. Do not rewrite shared history.
