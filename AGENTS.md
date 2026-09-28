# AGENTS.md — CodeBuddy Execution Contract

## 1. Mission

You are implementing Mentor Platform from the repository specs. Your job is to execute approved tasks, not redesign the product.

Do not invent product requirements.

If implementation conflicts with a specification, stop and report the conflict.

## 2. Source of Truth

The `specs/` directory is the single source of truth for product requirements, domain rules, architecture, database design, API contracts, security, privacy and acceptance criteria.

Before implementing any feature:

1. Read the relevant specification files.
2. Inspect the current implementation.
3. Identify dependencies.
4. Implement only the requested task.
5. Add or update tests.
6. Run typecheck, lint and tests.
7. Report the implementation result.

Repository reading order:

1. This file.
2. The task file in `implementation/task-breakdown.md`.
3. All specs referenced by that task.
4. `implementation/implementation-plan.md` for phase context.

## 3. Before Every Task

1. Read this file.
2. Read the task file.
3. Read all referenced specs.
4. Inspect current implementation and tests.
5. Identify impacted modules, DB tables, APIs and UI.
6. If the task conflicts with a spec, STOP and report the conflict. Do not silently reinterpret it.

## 4. Development Strategy

Implement the system incrementally.

Never attempt to implement the entire product in one operation.

The implementation order is defined in:

`implementation/task-breakdown.md`

Tasks should normally be executed sequentially. Execute tasks strictly in order unless a dependency is explicitly satisfied.

For each task:

1. Read task specification.
2. Inspect existing code.
3. Create implementation plan.
4. Implement.
5. Write tests.
6. Run lint, typecheck, unit tests and integration tests where relevant.
7. Review `git diff`.
8. Report: files changed, functionality implemented, tests executed, remaining issues.

Do not automatically start the next task unless the user asks you to continue.

## 5. Architecture Constraints

Use a modular monolith for V1. Do not introduce microservices in V1. Do not introduce unnecessary infrastructure.

- Backend: NestJS + TypeScript.
- Database: PostgreSQL + Prisma ORM.
- Cache/locks: Redis for caching, idempotency and short-lived locks.
- Frontend: WeChat Mini Program with TypeScript; use a consistent component/design system.
- Admin: Next.js + TypeScript.
- API style: REST JSON under `/api/v1`.
- Validation: DTO/schema validation at the API boundary.
- Auth: WeChat login -> server-issued access/refresh session.
- Authorization: RBAC + resource ownership + field-level access, enforced server-side.
- Money: integer minor units (`amountFen`, `amountCent`), never floating point. Column naming in the DB spec is `amount_minor`.
- Time: UTC in DB; API timestamps ISO-8601; display in configured user timezone.
- IDs: UUID/ULID; never expose sequential DB IDs as public identifiers.
- Soft delete where business history must be preserved.
- Audit log for admin, verification, payment, refund, settlement, moderation and permission changes.

Layering:

```text
controller
  -> application use case
     -> domain service / aggregate
        -> repository interface
           -> infrastructure adapter
```

## 6. Coding Rules

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
- Add DB indexes based on the query patterns in the DB spec.

## 7. Domain and Product Rules

The following rules are mandatory:

- V1 tutoring is the default enabled marketplace; career marketplace is feature-flagged.
- Provider verification is separate from provider approval.
- Identity verification does not automatically grant permission to provide services.
- Teacher compliance is a separate state.
- Provider cannot publish services before approval.
- Provider must be approved before being discoverable or orderable.
- A user may have multiple roles.
- One person may have multiple provider capabilities, but each capability has its own verification/status.
- Child profile belongs to a parent/guardian account.
- Child profiles are private. There is no public child profile.
- Child data is minimized and is not public.
- Sensitive identity documents are never public.
- Client cannot determine price.
- Client cannot determine order status.
- Payment success must be confirmed by the server.
- Order status can only change through explicit state transitions.
- Refund amount must be calculated by the server.
- Review requires an eligible completed order.
- Reviews are tied to completed orders.
- No review manipulation: one review per eligible order unless an approved edit flow exists.
- Provider and customer may not exchange direct contact information in public profile fields.
- IM must support report/block/moderation hooks.
- Admin mutations must be audited.

## 8. Money

All monetary values must use integer minor units.

Example: 100 RMB = 10000 cents.

Never use floating point for money.

Platform fee and provider payout are calculated server-side, and every fee version is recorded with the order.

All payment/refund operations must be idempotent.

## 9. Security and Privacy Rules

- Secrets only via environment/secret manager. Never commit secrets.
- Server-side enforcement only. Do not rely on frontend authorization.
- All protected resources require authentication and authorization.

Never expose:

- identity-card numbers
- identity documents
- private phone numbers
- private addresses
- child personal information
- internal moderation notes
- payment secrets
- access tokens
- refresh tokens

Never log:

- passwords
- access tokens / refresh tokens
- ID-card numbers
- raw identity documents
- payment secrets
- message contents
- full child profiles

(Unless a specific redacted audit requirement exists.)

Additional controls:

- Encrypt sensitive data at rest where supported.
- Signed URLs for private files; private bucket for verification documents.
- File uploads require type/size validation and malware/content checks where infrastructure supports it.
- Rate-limit authentication, messaging, verification, payment and public search APIs.
- All admin APIs require admin role and audit logging.
- Do not expose internal moderation notes to normal users.

## 10. API Rules

API base: `/api/v1`.

Use DTOs.

Never serialize ORM entities directly to API responses.

Every API response must expose only fields allowed by the specification. Response DTOs must be allowlists, not ORM entity serialization.

## 11. Database Rules

Use Prisma migrations.

Never manually modify production database schema.

Every schema change requires:

- migration
- relevant indexes
- tests
- updated specification if behavior changes

## 12. Testing Rules

Every business rule must have tests.

At minimum test:

- authentication
- authorization
- provider approval
- child data isolation
- order state machine
- payment idempotency
- refund limits
- review eligibility
- admin permissions

For every protected endpoint test:

- authenticated success
- unauthenticated failure
- wrong-role failure
- wrong-resource-owner failure
- invalid input
- rate limit where relevant

Critical user journeys require E2E tests (see `specs/14-test-strategy.md`).

## 13. Task Completion Checklist

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

## 14. Git Discipline

One logical task = one commit when practical.

Commit format:

```text
feat(scope): ...
fix(scope): ...
test(scope): ...
chore(scope): ...
docs(scope): ...
```

Use small logical commits. Do not squash unrelated work. Do not rewrite shared history.

Never commit secrets. Never modify unrelated files.

## 15. AI Behavior

Do not:

- invent APIs
- invent database fields
- invent business rules
- bypass state machines
- silently change architecture
- install unnecessary dependencies
- create fake production integrations
- replace real payment verification with client-side success callbacks

When uncertain, inspect the specification first.

If the specification is insufficient, stop and ask for clarification.
