# Implementation Plan

## Phase 0 — Repository bootstrap
- monorepo
- lint/format/typecheck
- CI
- environment config
- README
- database
- API skeleton

Exit: CI green.

## Phase 1 — Identity and profiles
- WeChat login
- user/session
- roles
- parent profile
- child profile
- consent
- provider profile

Exit: authenticated users can manage their own profiles.

## Phase 2 — Verification and provider publishing
- verification cases
- document upload abstraction
- admin verification queue
- provider approval
- service creation/publishing
- teacher compliance state

Exit: approved provider appears in discovery.

## Phase 3 — Discovery
- taxonomy
- search/filter
- provider detail
- service detail
- ranking
- privacy-safe DTOs

Exit: parent can find a provider.

## Phase 4 — Messaging
- IM adapter
- conversation
- block/report
- system messages

Exit: parent can contact provider.

## Phase 5 — Orders
- availability
- order
- state machine
- booking
- notifications

Exit: valid order can be created.

## Phase 6 — Payment
- payment adapter
- WeChat payment integration
- callback verification
- idempotency
- payment status

Exit: sandbox/test payment loop passes.

## Phase 7 — Completion, refund, review
- complete
- refund
- review
- moderation

Exit: full transaction lifecycle.

## Phase 8 — Admin/operations
- dashboard
- users
- providers
- orders
- reports
- audit
- feature flags
- platform rules

Exit: operator can run MVP without DB access.

## Phase 9 — Career domain
- mentor capability
- career services
- career profiles
- career discovery
- career orders

Behind feature flag.

## Phase 10 — Hardening
- security tests
- privacy tests
- load test
- observability
- backup/restore drill
- production checklist

## Phase 11 — AI matching
Only after real transaction data exists.
