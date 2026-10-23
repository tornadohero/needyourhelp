# Task Breakdown

Status and delivery evidence for every task live in [`progress.md`](progress.md); the task ids in both files are the same.

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

## T025 Git baseline
Git and engineering baseline: repository audit, git baseline audit, grouped commits, rollback anchor.
Input: `specs/`, `implementation/progress.md`, `implementation/task-breakdown.md`.
Output:
- `implementation/launch/repository-audit.md`
- `implementation/launch/git-baseline-audit.md`
- `implementation/launch/environment.md`
- `implementation/launch/launch-progress.md`
- annotated tag `baseline-t024`
Acceptance:
- every T001-T024 artifact is committed and pushed; working tree clean.
- `.env` is untracked; no secret, `node_modules`, build output or log in history.
- source on disk matches git (273/273, 28/28, 9/9).

## T026 Workspace and build
Install, generate, build, typecheck and lint the whole workspace from a clean state.
Input: `pnpm-workspace.yaml`, every workspace `package.json`, TypeScript configs, Prisma generator.
Output:
- `implementation/launch/build-verification.md`
- `nest build` no longer bulk-deletes `apps/api/dist` (`deleteOutDir: false`)
Acceptance:
- `pnpm install --frozen-lockfile`, `pnpm prisma:generate`, `pnpm build`, `pnpm typecheck`, `pnpm lint` all pass.
- failures are classified as environment or code, and fixed in the smallest necessary scope.

## T027 API contract audit
Audit the API contract as the source of truth before any frontend work; do not modify backend code.
Input: `apps/api` routers, `packages/api-contracts`, `specs/11-pages-and-ui.md`, `specs/12-admin-spec.md`.
Output:
- `implementation/frontend/api-contract-map.md`
- `implementation/frontend/miniprogram-page-map.md`
- `implementation/frontend/admin-page-map.md`
- `implementation/frontend/frontend-implementation-plan.md`
- `implementation/frontend/frontend-task-breakdown.md`
Acceptance:
- every route has method, auth, request DTO, response DTO, error codes, the UI page it serves and test evidence.
- 32 mini program pages and 14 admin pages are mapped to real endpoints.
- contract gaps are recorded as G1-G15 with the blockers (G1/G3/G4) flagged.

## T027b Backend gap closure G1/G3/G4
Close the three backend gaps that block frontend work.
Output:
- G1 `POST /auth/console/login`, `POST/DELETE /admin/console-credentials` (scrypt + salt, failure counter and lockout, rate limit, audit; login grants no role)
- G3 `PUT/GET /files/verification/:caseId/:documentId` (signed URL: purpose + key + expiry, content type whitelist, size limit)
- G4 `POST/GET /conversations/:id/messages` (membership, open conversation, block checks in both directions)
Acceptance:
- unit 425 / integration 280 over 46 files / E2E 8 all pass.
- no business refactor, no state machine change, no auth weakening.

## T028 Mini program init
Engineering foundation of the WeChat mini program; no business page yet.
Input: `implementation/frontend/api-contract-map.md`, `implementation/frontend/miniprogram-page-map.md`.
Output:
- 5-tab shell (home / discover / orders / messages / me), T001 placeholder page removed
- `src/core/{env,routes,envelope,errors,http,session,format}.ts`
- `src/config.ts`, `src/app-context.ts`, `src/platform/wechat.ts`, `src/services/auth.ts`
- contract drift guard (a page may not use an endpoint missing from the contract map)
- unit tests (38)
Acceptance:
- unit tests pass; no secret in the client; no invented endpoint; no mock replacing a real one.

## T029 Mini program account and auth
Account, profile and consent pages.
Input: `specs/11-pages-and-ui.md` (Profile / Settings / Consent), `specs/04-identity-and-profile-spec.md`.
Output:
- `src/core/account.ts`, `src/core/consents.ts`, `src/services/profile.ts` (+ tests)
- `pages/me` (profile view/edit, consent list with grant/revoke, underage and suspended states)
- unit tests (61)
Acceptance:
- `GET`/`PUT /me/profile`, consent list/grant/revoke against the real contract.
- suspended account shown read-only; no child PII rendered without consent.

## T030 Mini program provider discovery
Parent-side discovery: search, filter, list, provider and service detail.
Input: `specs/11-pages-and-ui.md` (Tutor search / Filter sheet / Tutor list / Tutor detail / Service detail), `specs/06-discovery-spec.md`.
Output:
- `src/core/{filters,paging,provider-view}.ts`, `src/services/discovery.ts` (+ tests)
- `pages/discover` (filter sheet, sort, paged load-more), `pages/provider` (services, reviews, slots)
- unit tests (89)
Acceptance:
- `GET /providers` is filtered and paged by the server; the client never re-filters locally.
- no child or private field appears in the list or detail view.

## T031 Mini program booking and orders
Parent-side booking and the order screens.
Input: `specs/11-pages-and-ui.md` (Create booking / Order detail / money screens), `specs/05-api-spec.md` §Orders, `specs/06-verification-state-machine.md` §Order, `specs/01-business-rules.md` §Orders, `implementation/frontend/frontend-task-breakdown.md` (FE-34, FE-36).
Output:
- `src/core/booking.ts` — the draft: service, the slot's own window, an optional child, a note; and the request body, which has no money field
- `src/core/order-view.ts` — order row/detail/refund view models, status labels, and which commands a state allows
- `src/core/children.ts`, `listChildren()` — the guardian's child picker, consent-gated
- `src/services/orders.ts` — `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`, `POST /orders/:id/refund-request`, `GET /orders/:id/refunds`
- `pages/booking`, `pages/order-detail`, the real `pages/orders` list, and the booking entry on `pages/provider`
- unit tests (45)
Acceptance:
- a booking never sends an amount, a price, a fee or a status: the server derives them, and the client's request type has no field for them.
- the scheduled window is the chosen slot's own, so a client cannot ask for a window the provider never published.
- a money screen shows service, duration, unit price, total and order number, all from the order the server recorded.
- a status is read, never written: cancel and refund-request are commands, and 409 reloads the order instead of retrying the write.
- cancellation/refund rules are never hidden behind a shortened label.

## T032 Mini program provider desk
The provider side of the mini program: onboarding, services, availability and delivery.
Input: `specs/11-pages-and-ui.md` §Provider pages, `specs/01-business-rules.md` §Provider approval / §Services, `specs/06-verification-state-machine.md` §Order, `specs/05-api-spec.md` §Services / §Availability, `implementation/frontend/frontend-task-breakdown.md` (FE-40, FE-42, FE-43, FE-44, FE-46).
Output:
- `src/core/provider-desk.ts` — the provider's own record as a view model (approval, `searchable`, capabilities, verification), the one command an order can run, and the application body
- `src/core/service-form.ts` — the service editor: the provider's own price and duration, sent as integer minor units
- `src/core/slot-form.ts` — a wall-clock window as the ISO pair the API speaks
- `src/services/provider-desk.ts` — `GET /providers/me`, `POST /providers/applications`, `POST /providers/me/submit`, `GET/POST /providers/me/services`, publish/unpublish, `GET/POST/DELETE` availability, `confirm` / `start` / `complete`
- `pages/provider-desk`, `pages/provider-services`, `pages/provider-slots`, `pages/provider-orders`, and the entry on `pages/me`
- unit tests (47)
Acceptance:
- a provider reads their own record, including what the public payload hides, but never sets approval, `searchable` or a role: those are commands the server owns.
- publishing a service is refused while approval is missing, and the refusal is shown with the server's reason instead of being hidden.
- an overlapping slot is answered by the server, not pre-checked on the client (T011 owns the invariant).
- delivery is exactly three commands — accept, start, finish — and a 409 reloads the order instead of retrying.
- the provider's price is sent as integer minor units; no float reaches the wire.

## T033 Admin console
The operations console: login, dashboard and the pages operators run the platform from.
Input: `specs/12-admin-spec.md`, `specs/11-pages-and-ui.md` §Admin Web, `specs/07-permission-spec.md`, `implementation/frontend/admin-page-map.md`, `implementation/frontend/frontend-task-breakdown.md` (FE-01..FE-06, FE-10..FE-13, FE-15, FE-18..FE-22).
Output:
- `apps/admin/src/lib/` — env (one setting), transport (`{data}` unwrap, request id, typed errors), session (httpOnly cookie, serialised only), the admin client (every use case), view models, server actions
- `apps/admin/app/` — login, console shell with a session guard, and pages: dashboard, provider review, verification queue, orders and refunds, users and roles, audit log, feature flags, taxonomy, platform rules
- unit tests (34 new)
Acceptance:
- the access token never reaches the browser: every call happens on the server and the session lives in an httpOnly cookie.
- a decision always carries a reason, because the server requires one and the audit log is the record of why.
- a refund carries an `Idempotency-Key` and no invented amount; taxonomy is archived, never deleted; a rule is published by an explicit confirmed command.
- a `FORBIDDEN` is shown, not hidden, and a platform error is rendered as the platform's sentence — never a stack trace.
- the dashboard shows only what the API returned: no trend chart, because there is no time series endpoint (G6/G13).

## T034 Redis and dependency completeness
Shared rate-limit counters and idempotency keys, and a dependency set that installs from a clean state.
Input: `AGENTS.md` §5 (Redis for cache/idempotency/locks), `specs/03-architecture-spec.md` §Idempotency, `specs/13-security-spec.md` §API (rate limiting), `implementation/launch/repository-audit.md` (blocker B3).
Output:
- `src/infrastructure/redis/` — the client handle (`REDIS_URL`, optional), narrow command surface, `@Global()` module with a clean shutdown
- `src/common/security/redis-rate-limiter.ts` — shared fixed window (`INCR`/`EXPIRE`/`TTL`) with an in-process fallback
- `src/common/idempotency/redis-idempotency.store.ts` — `SET NX` claim, stored answer, fingerprint conflict, claim released when the work fails
- wiring in `SecurityModule`, `PaymentsModule`, `RefundsModule` (optional injection, so a module still builds alone)
- `ops/redis.md`, and an `engines`/lockfile check that `pnpm install --frozen-lockfile` still passes
- unit tests (18)
Acceptance:
- with Redis configured, counters and idempotency keys are shared: a retry that lands on another instance is still the same call.
- without Redis (or when it fails) the platform degrades to the in-process stores and logs it once — never a 500 caused by Redis.
- a failed idempotent `work` releases its claim, so a retry runs it again; the same key with a different payload is `IDEMPOTENCY_CONFLICT`, never a replay.
- `pnpm install --frozen-lockfile` passes from the committed lockfile.

## T035 Three-end E2E
One journey told by the three clients against one real server.
Input: `specs/14-test-strategy.md` §E2E, `specs/12-admin-spec.md`, `implementation/frontend/frontend-task-breakdown.md` (FE-60, FE-61, FE-62), `apps/api/test/e2e` (the existing single-end journeys).
Output:
- `apps/e2e` — a workspace package that builds and boots the API as a real process on a disposable database, then drives it with the **shipping** mini program modules and the **shipping** admin client over real HTTP
- `apps/miniprogram/src/index.ts` and `apps/admin` exports: the portable surface of each client (pages are not exported)
- `apps/e2e/test/three-end-journey.spec.ts` — apply → evidence upload → console approval → publish → discover → book → pay → deliver → refund → audit
- root `test:e2e-three` script and a CI step
Acceptance:
- the server between the ends is the one `main.ts` boots: compiled, listening, on a database rebuilt from the committed migrations. No end stubs another.
- the mini program and the admin console run their own code — session, envelope, view models, commands — against that server.
- only two steps use raw HTTP, and both are named in the test: the mock-gateway payment callback (the parent payment screen is a later task) and the first-administrator bootstrap.
- the journey ends where an auditor would look: the refund is idempotent, the parent sees the refund, and the operator's decisions are in the audit log.

## T035b Parent payment screen
The money screen and the payment flow of the mini program (FE-35), done before T036 because it is the last missing step of the parent journey.
Input: `specs/11-pages-and-ui.md` §Parent pages (Payment / money screens), `specs/08-payment-and-settlement.md` (server confirms), `implementation/frontend/frontend-task-breakdown.md` (FE-35), `implementation/frontend/api-contract-map.md` §Payments.
Output:
- `src/core/payment.ts` — session and status view models, and the narrowing of the provider's own cashier parameters
- `src/services/payments.ts` — session, status, polling until the server knows, and a **local-only** seam that plays the gateway callback for the `MOCK` provider
- `src/platform/wechat.ts` — `wx.requestPayment` as the only place that opens a cashier
- `pages/payment` and the "去支付" entry on `pages/order-detail`
- unit tests (18)
Acceptance:
- the screen is believed only when `GET /orders/:id/payment-status` says so; a resolved `wx.requestPayment` is a hint, never the answer.
- the money screen shows service, duration, unit price, total, order number and the refund rule, all from the order the server recorded.
- the cashier is opened only with a real signature in hand: without `paySign` the client does not call WeChat at all.
- the mock seam refuses to run for any provider other than `MOCK`, so it cannot become a production path.
- a timeout while polling is reported as "the server still does not know", not as failure.

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

Never generate T001-T035b in one uncontrolled pass.
