# Task Breakdown

## T001 Repo bootstrap
Input: README, AGENTS, architecture.
Output:
- pnpm workspace
- apps/api
- apps/admin
- apps/miniprogram
- packages/shared
- packages/api-contracts
- CI
Acceptance:
- install/build/lint/typecheck all pass.

## T002 Database foundation
Implement Prisma schema, migrations, seed taxonomy.
Acceptance:
- fresh DB migration works.
- seed creates admin/test users and taxonomy.

## T003 Auth
Implement WeChat auth adapter interface + mock provider.
Acceptance:
- login creates user/session.
- refresh/logout work.
- no client-controlled role assignment.

## T004 Profile and consent
Implement user/profile/consent/child.
Acceptance:
- guardian ownership enforced.
- consent version recorded.
- private child data not in public DTOs.

## T005 Provider onboarding
Implement provider profile/capabilities/application.
Acceptance:
- provider cannot publish before approval.

## T006 Verification
Implement cases/documents/status and mock gateway.
Acceptance:
- documents private.
- admin approval/rejection audited.

## T007 Teacher compliance
Implement configurable compliance state/restriction.
Acceptance:
- teacher with pending compliance cannot be ordered.
- approved teacher can only access permitted service.

## T008 Catalog
Implement city/grade/subject/skill taxonomy.
Acceptance:
- admin CRUD with audit.

## T009 Services
Implement provider services.
Acceptance:
- server validates price/duration.
- publish state machine.

## T010 Discovery
Implement provider list/detail/search/filter.
Acceptance:
- only discoverable providers.
- private fields excluded.

## T011 Availability
Implement provider slots.
Acceptance:
- no overlapping confirmed bookings.
- race condition test.

## T012 IM adapter
Implement conversation abstraction + mock adapter.
Acceptance:
- block prevents new chat.
- report creates moderation case.

## T013 Orders
Implement order aggregate and state machine.
Acceptance:
- no direct status PATCH.
- server calculates total.

## T014 Payment adapter
Implement payment session + mock gateway.
Acceptance:
- idempotency.
- callback replay safe.
- amount mismatch rejected.

## T015 WeChat payment integration
Implement production adapter using official API flow.
Acceptance:
- secrets externalized.
- server callback/query confirms payment.

## T016 Refund
Implement policy engine + refund workflow.
Acceptance:
- cannot refund more than captured.
- idempotent.

## T017 Completion/review
Implement completion, eligibility, review.
Acceptance:
- review only after completed order.
- one review per eligible direction/order.

## T018 Reports/moderation
Implement report, block, moderation state.
Acceptance:
- admin action audited.
- appeal path supported.

## T019 Admin
Implement all operations pages.
Acceptance:
- MVP can run without direct DB edits.

## T020 Analytics
Implement event abstraction and core funnel events.
Acceptance:
- no child PII in analytics.

## T021 Career domain
Implement career mentor capability and service.
Acceptance:
- feature flag off hides all career UI/routes.
- when on, reuses provider/order/payment/review infrastructure.

## T022 Security hardening
Implement rate limits, security headers, field-level DTOs, private object access.
Acceptance:
- security test suite passes.

## T023 E2E
Implement all E2E in test strategy.
Acceptance:
- CI green.

## T024 Production readiness
- backups
- restore test
- monitoring
- alerts
- runbook
- incident response
- release checklist.

## CodeBuddy execution instruction

Execute tasks strictly in order unless a dependency is explicitly satisfied.

For each task:
1. Read referenced specs.
2. Inspect repository.
3. Implement smallest complete slice.
4. Add tests.
5. Run formatter/linter/typecheck/tests.
6. Update API/schema docs.
7. Report files changed and acceptance results.
8. Stop before the next task unless the user asks to continue.

Never generate T001-T024 in one uncontrolled pass.
