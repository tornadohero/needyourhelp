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

# Mentor Platform AI Development Rules

## 1. Source of Truth

The `/spec` directory is the single source of truth for product requirements, domain rules, architecture, database design, API contracts, security, privacy and acceptance criteria.

Before implementing any feature:

1. Read the relevant specification files.
2. Inspect the current implementation.
3. Identify dependencies.
4. Implement only the requested task.
5. Add or update tests.
6. Run typecheck, lint and tests.
7. Report the implementation result.

Do not invent product requirements.

If implementation conflicts with the specification, stop and report the conflict.

## 2. Development Strategy

Implement the system incrementally.

Never attempt to implement the entire product in one operation.

The implementation order is defined in:

`/implementation/task-breakdown.md`

Tasks should normally be executed sequentially.

## 3. Architecture

Use a modular monolith for V1.

Backend:

* NestJS
* TypeScript
* PostgreSQL
* Prisma
* Redis

Frontend:

* WeChat Mini Program
* TypeScript

Admin:

* Next.js
* TypeScript

Do not introduce microservices in V1.

Do not introduce unnecessary infrastructure.

## 4. Domain Rules

The following rules are mandatory:

* Provider verification is separate from provider approval.
* Identity verification does not automatically grant permission to provide services.
* Teacher compliance is a separate state.
* Provider cannot publish services before approval.
* Client cannot determine price.
* Client cannot determine order status.
* Payment success must be confirmed by the server.
* Order status can only change through explicit state transitions.
* Refund amount must be calculated by the server.
* Review requires an eligible completed order.
* Child profiles are private.
* Sensitive identity documents are never public.
* Admin mutations must be audited.

## 5. Security

Never expose:

* identity-card numbers
* identity documents
* private phone numbers
* private addresses
* internal moderation notes
* payment secrets
* access tokens
* refresh tokens

Never log sensitive personal information.

All protected resources require authorization.

Do not rely on frontend authorization.

## 6. Money

All monetary values must use integer minor units.

Example:

100 RMB = 10000 cents.

Never use floating point for money.

All payment/refund operations must be idempotent.

## 7. API

API base:

`/api/v1`

Use DTOs.

Never serialize ORM entities directly to API responses.

Every API response must expose only fields allowed by the specification.

## 8. Database

Use Prisma migrations.

Never manually modify production database schema.

Every schema change requires:

* migration
* relevant indexes
* tests
* updated specification if behavior changes

## 9. Testing

Every business rule must have tests.

At minimum test:

* authentication
* authorization
* provider approval
* child data isolation
* order state machine
* payment idempotency
* refund limits
* review eligibility
* admin permissions

Critical user journeys require E2E tests.

## 10. Task Execution

For each task:

1. Read task specification.
2. Inspect existing code.
3. Create implementation plan.
4. Implement.
5. Write tests.
6. Run:

   * lint
   * typecheck
   * unit tests
   * integration tests where relevant
7. Review git diff.
8. Report:

   * files changed
   * functionality implemented
   * tests executed
   * remaining issues

Do not automatically start the next task.

## 11. Git

Use small logical commits.

Preferred format:

`feat(scope): description`

`fix(scope): description`

`test(scope): description`

`docs(scope): description`

Never commit secrets.

Never modify unrelated files.

## 12. AI Behavior

Do not:

* invent APIs
* invent database fields
* invent business rules
* bypass state machines
* silently change architecture
* install unnecessary dependencies
* create fake production integrations
* replace real payment verification with client-side success callbacks

When uncertain, inspect the specification first.

If the specification is insufficient, stop and ask for clarification.

