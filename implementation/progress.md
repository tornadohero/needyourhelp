# Implementation Progress

Source of truth: `specs/`. Task order: `implementation/task-breakdown.md`.
A task is only marked `done` when every acceptance criterion in
`implementation/task-breakdown.md` passes and lint/typecheck/tests are green.

## Status

| Task | Title | Status | Acceptance |
|---|---|---|---|
| T001 | Repo bootstrap | done | install/build/lint/typecheck pass (CI green) |
| T002 | Database foundation | done | fresh DB migration works; seed creates admin/test users and taxonomy |
| T003 | Auth | done | login creates user/session; refresh/logout work; no client-controlled role assignment |
| T004 | Profile and consent | done | guardian ownership enforced; consent version recorded; private child data not in public DTOs |
| T005 | Provider onboarding | done | provider cannot publish before approval |
| T006 | Verification | done | documents private; admin approval/rejection audited |
| T007 | Teacher compliance | done | pending compliance teacher not orderable; approved teacher restricted to permitted service |
| T008 | Catalog | done | admin taxonomy CRUD audited; terms archived, never deleted |
| T009 | Services | done | price/duration validated server-side; publish state machine gated by provider approval |
| T010 | Discovery | done | only discoverable providers listed/shown; no private or workflow field in public payloads |
| T011 | Availability | done | no overlapping confirmed bookings (slot invariant + atomic claim, race-tested) |
| T012 | IM adapter | done | block prevents new chat (both directions); report creates a moderation case |
| T013 | Orders | done | no direct status PATCH (commands + state machine); server calculates total/fee/payout |
| T014 | Payment adapter | done | idempotent session; callback replay safe (one transition); amount mismatch rejected |
| T015 | WeChat payment integration | done | secrets externalized (env/secret manager, fail-fast, never logged); callback signature + query confirm payment |
| T016 | Refund | done | cannot refund more than captured; idempotent request and command |
| T017 | Completion/review | done | review only after a completed order; one review per order and direction |
| T018 | Reports/moderation | done | every admin action audited; appeal path supported and reviewed independently |
| T019 | Admin | done | every operations page backed by an endpoint; MVP starts without a direct DB edit (audited bootstrap) |
| T020 | Analytics | done | event abstraction + core funnel events; a child is never a dimension |
| T021 | Career domain | done | flag off closes every career route (applying, publishing, ordering by id, reviews); flag on reuses provider/service/availability/order/payment/review unchanged |
| T022 | Security hardening | done | rate limits (account/IP), secure headers, CORS allowlist, body size limits, field-level responses, private object access verified |
| T023 | E2E | done | all eight journeys of `specs/14` run against the whole app; `pnpm test:e2e` in CI |
| T024 | Production readiness | done | backup/restore scripts + a restore drill that runs in CI; readiness probe; structured access logs; alerts, runbook, incident response, release checklist |
| T025 | Git baseline | done | repository audit + git baseline audit; all T001–T024 work committed (`1d19e70`) and pushed; `.env` untracked, no secret in history; baseline tag `baseline-t024`; grouped commit plan for the remaining scope |
| T026 | Workspace & build | done | install/prisma:generate/build/typecheck/lint all pass; `nest build` no longer bulk-deletes `apps/api/dist` (`deleteOutDir: false`); build verification report |
| T027 | API contract audit | done | API contract map, miniprogram/admin page maps, implementation plan and task breakdown under `implementation/frontend/`; 15 contract gaps (G1–G15) recorded |
| T027b | Backend gap closure G1/G3/G4 | done | admin console login (scrypt credentials, lockout, rate limit, audit); signed object upload/download route; conversation send/list messages; unit 425, integration 280/46, E2E 8 |
| T028 | Mini program init | done | WeChat mini program engineering: 5-tab shell, wx.login session with single-flight refresh, injected-transport ApiClient, contract drift guard, 38 unit tests |
| T029 | Mini program account & auth | done | account/profile/consent use cases: GET-PUT /me/profile, consent list/grant/revoke, account view model with suspended state, 61 unit tests |
| T030 | Mini program provider discovery | done | discovery: GET /providers with normalised filters, paged load-more, provider detail (services/reviews/slots), filter sheet + sort UI, 89 unit tests |
| T031 | Mini program booking & orders | done | booking (service + the slot's own window + optional child, no money sent), order list/detail, cancel and refund-request commands, child picker consent-gated; 45 new unit tests (134 total) |
| T032 | Mini program provider desk | done | provider desk (own record, application, submit for review, verification status), service management (create/publish/unpublish), availability management, delivery commands confirm/start/complete; 47 new unit tests (181 total) |
| T033 | Admin console | done | Next.js operations console: console login (httpOnly session), dashboard, provider review, verification queue with signed document access, orders and idempotent refunds, users and roles, audit log, feature flags, taxonomy (archive only), platform rules (explicit publish); 34 new admin unit tests (36 total) |
| T034 | Redis & dependency completeness | done | ioredis-backed rate limiter (INCR/EXPIRE/TTL) and idempotency store (SET NX claim + stored answer) with in-process fallback; optional DI so modules build alone; `ops/redis.md`; lockfile still `install --frozen-lockfile` clean; 18 new unit tests (445 api) |

## T002 — Database foundation

- Prisma schema: 28 V1 tables, snake_case mapping, integer minor-unit money.
- Migration: `prisma/migrations/20260929035555_init` (spec indexes included).
- Deferred V1.1 tables (`settlements`, `settlement_items`, `career_goals`,
  `mentor_capabilities`) intentionally not created; asserted by tests.
- Seed: `prisma/seed-data.ts` (+ `prisma/seed.ts`), idempotent: 7 users/roles,
  6 feature flags, 28 taxonomy terms.
- Repositories: `PrismaService`, `UserRepository`, `TaxonomyRepository`.
- Tests: 8 integration files, 49 tests against a disposable database.

## T003 — Auth

### Delivered

- Provider abstraction: `WeChatAuthProvider` port with
  `MockWeChatAuthProvider` (dev/test only) and `WeChatHttpAuthProvider`
  (real `code2Session`; credentials from config, never logged).
- Session/token management: short-lived HS256 access tokens (`sid` + `jti`),
  32-byte opaque refresh tokens stored only as SHA-256 hashes, rotation on every
  use, replay detection revoking the whole rotation chain, logout, expiry.
- Endpoints: `POST /auth/wechat/login`, `POST /auth/refresh`,
  `POST /auth/logout`, `GET /me` (all under `/api/v1`).
- Guards: `JwtAuthGuard` (401 `AUTH_REQUIRED`), `OptionalJwtAuthGuard` (logout),
  `RolesGuard` + `@Roles()` (403 `FORBIDDEN`), `@CurrentUser()`.
- Contract types added to `packages/api-contracts` (`auth.ts`, `ENDPOINTS.me`).

### Security decisions

- Roles come only from `user_roles`; new accounts get `USER`. Login DTO accepts
  only `code`, and the global `ValidationPipe` uses
  `{ whitelist: true, forbidNonWhitelisted: true }`, so a client-supplied
  `role`/`userId` is rejected with `VALIDATION_ERROR` (verified by HTTP test and
  runtime smoke test).
- No client value ever selects the user id: the subject is derived from the
  verified token and the persisted session.
- WeChat openid/unionid are stored as HMAC-SHA256 with `OPENID_HASH_PEPPER`.
- Mock login throws `MockProviderNotAllowedError` outside
  `local|development|test`; `AUTH_PROVIDER=wechat` is required in production.
- No AppSecret/token is committed: secrets live in `.env` (gitignored) and are
  injected as CI environment variables.

### Tests

- Unit (46 in `apps/api`, incl. 31 auth tests): hashing, JWT issue/verify/expiry,
  mock provider guard, `AuthService` (login, rotation, replay, expiry, logout,
  suspended/deleted accounts, allowlist), guards.
- Integration (49 total, 20 auth): session lifecycle against PostgreSQL
  (`auth-session.spec.ts`) and HTTP contract tests (`auth-http.spec.ts`:
  authenticated success, unauthenticated 401, wrong-role 403, invalid input 400).

### Deferred / known gaps

- Rate limiting on auth endpoints is not implemented (owned by T022); the
  guards currently issue one session lookup per request (no Redis cache yet).
- Session cleanup of expired rows is not scheduled yet (index
  `sessions(expires_at)` exists for it).
- `REFRESH_TOKEN_SECRET` remains unused: refresh tokens are opaque and stored
  hashed, so no signing secret is needed. It stays in `.env.example` for the
  future session/CSRF work.

### Database impact

None. T003 uses the T002 `users`, `user_roles` and `sessions` tables as-is; no
migration was added or modified.

## T004 — Profile and consent

### Delivered

- `GET|PUT /api/v1/me/profile`: account display fields plus the 1:1 guardian
  profile (`parent_profiles`), upserted on first use.
- Child profiles: `POST|GET /me/children`, `GET|PATCH|DELETE /me/children/:id`.
- Consent: `GET|POST /me/consents`, `DELETE /me/consents/:consentType`
  (explicit grant + withdrawal).
- New module `apps/api/src/modules/profile/` (domain / application /
  infrastructure / http) plus a consent port + Prisma adapter in
  `modules/identity/` (consent belongs to the Identity context per
  `specs/02-domain-model.md`).
- Contract types added to `packages/api-contracts` (`profile.ts`,
  `ENDPOINTS.meProfile | meChildren | meConsents`).

### Rules enforced

- **Guardian ownership**: every child route resolves the child through the
  authenticated account; a non-guardian gets `CHILD_ACCESS_DENIED` (403) on
  read, update and delete, and never sees the child in their own list
  (E2E-06). Unknown/deleted children return `NOT_FOUND` (404).
- **Consent**: `child_profiles` may only be created/updated while an active
  `MINOR_GUARDIAN` consent exists, otherwise `CONSENT_REQUIRED` (403). The
  consent is captured with the child (acceptance test AT-020) and records
  policy version, timestamp, actor (the authenticated account) and an evidence
  reference (`request:<requestId>`). Grants are append-only, withdrawal
  timestamps the active row; withdrawing guardian consent mirrors `REVOKED`
  onto the guardian's children while deletion rights stay available.
- **Private child data**: the only mapper allowed to emit child detail is
  guardian-scoped; `/me` and `/me/profile` never carry child data. DTOs are
  allowlists with `forbidNonWhitelisted`, so `userId`, `guardianUserId` or
  `role` in a request body is rejected with `VALIDATION_ERROR`.
- Deletion is a soft delete (`deleted_at`) so order history keeps resolving.

### Tests

- Unit (19 new, 65 total in `apps/api`): consent records/history/withdrawal and
  the child-status mirror; child create/list/get/update/delete with ownership,
  consent and soft-delete rules; profile read/update (also asserts no identity
  hash is exposed).
- Integration (20 new, 69 total): repository behaviour against PostgreSQL
  (`profile-repository.spec.ts`) and HTTP contract tests
  (`profile-http.spec.ts`: authenticated success, unauthenticated 401,
  wrong-owner 403 `CHILD_ACCESS_DENIED`, invalid input 400, child isolation,
  consent capture and withdrawal).
- Runtime smoke against the built app: profile update, child creation with
  consent, cross-guardian 403, consent withdrawal (data cleaned up afterwards).

### Deferred / known gaps

- **Spec gap**: `specs/05-api-spec.md` defines no consent endpoint, but
  `specs/10-privacy-and-minors.md` requires explicit versioned consent records
  and a withdrawal path. The minimal `GET|POST /me/consents` +
  `DELETE /me/consents/:consentType` was added to satisfy T004; it should be
  ratified into the API spec.
- `policyVersion` is recorded verbatim; it is not yet validated against
  published rows of `platform_rules` (T019 owns rule publishing).
- `city_code` is format-validated only, not resolved through `taxonomy_terms`
  (T008 owns taxonomy management).
- No audit-log rows for self-service profile/child mutations: consent records
  are the audit trail for consent and admin auditing is T006/T019.
- `child_profiles.school_name` is stored in clear text in the database;
  field-level encryption belongs to T022.
- No child projection for non-guardian workflow participants yet: none exists
  until orders (T013). When added, it must use a narrower allowlist.

### Database impact

None. T004 uses the T002 `parent_profiles`, `child_profiles` and `consents`
tables as-is; no migration was added or modified.

## T005 — Provider onboarding

### Delivered

- `POST /providers/applications`, `GET /providers/me`, `PATCH /providers/me`,
  `POST /providers/me/submit` (`specs/05-api-spec.md` §Provider).
- Admin decisions required by the acceptance criterion:
  `POST /admin/providers/:id/approve`, `POST /admin/providers/:id/reject`
  (ADMIN/OPS only, audited).
- New module `apps/api/src/modules/provider/` (domain / application /
  infrastructure / http) plus two small support contexts reused by later tasks:
  `modules/audit/` (append-only `audit_logs`) and `modules/platform/`
  (feature flags).
- Contract types added to `packages/api-contracts` (`provider.ts`,
  `ENDPOINTS.providers | providerApplications | providerMe | providerSubmit |
  adminProviders`).
- Capabilities are created with the application and replaced through
  `PATCH /providers/me` while the application is editable: `specs/05-api-spec.md`
  defines no capability endpoint, so none was invented.

### Rules enforced

- **No publishing before approval** (acceptance criterion): `canPublish` requires
  `approval_status = APPROVED` *and* an active account; `assertCanPublish` is the
  single gate T009 (service publish) must call and raises
  `PROVIDER_NOT_APPROVED` (409). Discovery (`searchable`) additionally requires
  the verification gate (T006) and a published service (T009), so approval alone
  never makes a provider visible (`specs/01-business-rules.md` §Provider
  approval).
- **State machine**: `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED`,
  resubmission after a rejection, suspension orthogonal. Only the transitions in
  `PROVIDER_TRANSITIONS` are allowed; the provider may edit only while
  `DRAFT`/`REJECTED`.
- **No client-controlled status**: `approvalStatus`, `searchable`, `role` and
  rating fields are absent from every DTO and `forbidNonWhitelisted` is on, so a
  self-approval attempt fails with `VALIDATION_ERROR` (verified by HTTP test and
  runtime smoke: "property approvalStatus should not exist").
- **Provider cannot approve itself**: the decision routes require ADMIN/OPS via
  `RolesGuard`; a provider token gets `FORBIDDEN` (403).
- **Approval grants the `PROVIDER` role** (never the client) and both the
  decision and the role change are written to `audit_logs` with actor, request
  id, IP hash and before/after snapshot (`specs/06` §Admin decision
  requirements, `specs/12-admin-spec.md` §Audit). A rejection requires a reason.
- **Career marketplace stays flagged**: a `CAREER` application is rejected with
  `FORBIDDEN` while `career_marketplace_enabled=false` (`AGENTS.md` §7).
- Capabilities are domain-scoped (`CAREER_MENTOR` cannot be claimed by a tutoring
  provider); `TEACHER` starts with `compliance_status = PENDING`.

### Tests

- Unit (30 new, 95 total in `apps/api`): state-machine transition matrix,
  editability/submission windows, publication and discovery gates; application
  create (capabilities, dedupe, domain mismatch, duplicate, suspended account,
  career flag), edit/replace capabilities, submit/resubmit discipline,
  `assertCanPublish`, `searchable` recomputation; admin approve/reject
  (transitions, role grant, idempotent role grant, audit rows, missing reason).
- Integration (18 new, 87 total): repository behaviour against PostgreSQL
  (`provider-repository.spec.ts`) and HTTP contract tests
  (`provider-http.spec.ts`: authenticated success, unauthenticated 401,
  wrong-role 403, invalid input 400, unknown target 404, publish gate before and
  after approval, audited decisions, rejection + resubmission).
- Runtime smoke against the built app: application → submit → non-admin 403 →
  admin approve → `PROVIDER` role granted → career application blocked
  (data cleaned up afterwards).

### Deferred / known gaps

- **Spec gap**: `specs/05-api-spec.md` has no provider approve/reject endpoint,
  but `specs/12-admin-spec.md` §Provider review workflow requires the action and
  `specs/06` requires it to be audited. The two minimal admin routes above were
  added to satisfy the T005 acceptance criterion; they should be ratified into
  the API spec.
- **Spec gap**: no provider-state conflict code exists, so an illegal transition
  or an edit after submission uses `VALIDATION_ERROR` (400).
- `POST /admin/providers/:id/suspend` and `/restore` are still missing: they are
  listed in the admin section of the API spec and belong to T019. The state
  machine and the discovery gate already handle `SUSPENDED`.
- Verification results (T006) and published services (T009) are resolved through
  the `ProviderReadinessGates` port, whose T005 implementation returns `false`
  for both: an approved provider therefore stays `searchable=false` until those
  tasks replace the adapter.
- Teacher compliance transitions (`PENDING -> APPROVED/RESTRICTED/...`) are T007;
  capability verification levels stay `NONE` until T006.
- Capability-level approval (as opposed to provider-level approval) is not wired:
  it depends on verification (T006) and compliance (T007) outcomes.
- `city_code` is format-validated only, not resolved through `taxonomy_terms`
  (T008 owns taxonomy management).
- No admin queue/listing endpoint (`GET /admin/providers`) yet: T019.

### Database impact

None. T005 uses the T002 `provider_profiles`, `provider_capabilities` and
`audit_logs` tables as-is; no migration was added or modified.

## T006 — Verification

### Delivered

- Case intake and submission (`specs/05-api-spec.md` §Verification):
  `POST /verification/cases`, `GET /verification/me`,
  `POST /verification/cases/:id/documents/upload-url`,
  `POST /verification/cases/:id/submit`.
- Admin review (`specs/05-api-spec.md` §Admin, `specs/12-admin-spec.md`):
  `GET /admin/verifications` (newest-first queue),
  `POST /admin/verifications/:id/approve`,
  `POST /admin/verifications/:id/reject`, plus the minimal audited
  `POST /admin/verifications/:id/documents/:documentId/access-url`.
- New module `apps/api/src/modules/verification/` (domain / application /
  infrastructure / http).
- `ObjectStorage` port + `MockObjectStorageGateway`, mirroring
  `specs/03-architecture-spec.md` §External provider ports
  (`createUploadUrl` / `createDownloadUrl`) — the "mock gateway" of T006.
- Shared helpers: `common/runtime/environment.ts` (single source for the
  "mock adapters are refused in production" rule, now also used by T003's mock
  WeChat provider) and `common/security/seal.ts` (AES-256-GCM sealing for
  `verification_documents.encrypted_metadata`).
- Contract types added to `packages/api-contracts` (`verification.ts`,
  `ENDPOINTS.verificationCases | verificationMe | adminVerifications`).
- Readiness wiring: T005's `PROVIDER_READINESS_GATES` is now
  `ComposedProviderReadinessGates` over two ports —
  `VERIFICATION_READINESS` (real: `PrismaVerificationReadiness`) and
  `SERVICE_READINESS` (still deferred to T009). The obsolete
  `DeferredProviderReadinessGates` was removed.

### Rules enforced

- **Documents are private** (acceptance criterion):
  - the object key is generated by the server and is never accepted from a
    client (`specs/13-security-spec.md` §File upload); the key also carries a
    random suffix so it is unguessable;
  - `storageKey`, `fileHash` and `encryptedMetadata` are absent from every
    response DTO; the only place a key appears is the signed upload URL issued
    to the owner of the case, and that is by design;
  - metadata (original file name, content type, size) is sealed with AES-256-GCM
    before it is stored (`specs/10-privacy-and-minors.md`);
  - uploads are whitelisted (JPEG/PNG/WEBP/PDF), size-bounded and require a
    SHA-256 file hash (`verification_documents.file_hash` is NOT NULL);
  - a document is readable only through a short-lived signed URL (5 min), issued
    to ADMIN/OPS only, and every issuance writes an audit row
    (`specs/12-admin-spec.md`: "Identity-document access is logged";
    `specs/07-permission-spec.md`).
- **Admin approval/rejection is audited** (acceptance criterion): one
  `audit_logs` row per decision with actor, actor type, reason code, optional
  notes, target resource, before/after snapshot, IP hash and request id
  (`specs/06` §Admin decision requirements); a reason code is mandatory for both
  outcomes and is checked in the service, not only in the DTO.
- **State machine** (`specs/06` §Identity verification):
  `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED -> RESUBMITTED`,
  with `APPROVED` terminal. Submission requires at least one document; evidence
  can only be attached while the case is `DRAFT`/`RESUBMITTED`. Only explicit
  commands change a status; `status` in a request body is rejected by
  `forbidNonWhitelisted`.
- **Verification is separate from provider approval** (`specs/01`): approving
  identity/education updates `provider_capabilities.verification_level`
  (`IDENTITY` / `EDUCATION` / `FULL`) and recomputes `searchable`, but a
  provider is still not discoverable without an approved application and a
  published service (T009); identity verified never grants permission to
  provide a service.
- Ownership: a case can only be read, extended or submitted by its own provider;
  another provider's case is `FORBIDDEN` (403) and an unknown id is
  `NOT_FOUND` (404).

### Tests

- Unit (40 new, 135 total in `apps/api`): transition matrix, editable/decidable
  windows, submission targets, verification-level mapping, discovery gate;
  intake (needs a provider application, one case per provider and type,
  server-generated key, MIME/size/hash rejection, cross-provider `FORBIDDEN`,
  submit/resubmit discipline, own-cases listing); admin (approval and rejection
  audited, reason code required, illegal transitions, capability level sync,
  `searchable` recomputation, audited document access, cross-case refusal,
  newest-first queue); mock gateway (signed, purpose-bound, expiring URLs,
  production refusal); sealing (round-trip, non-determinism, tamper detection,
  key resolution).
- Integration (18 new, 105 total): repository behaviour against PostgreSQL
  (`verification-repository.spec.ts`, including the readiness gate) and HTTP
  contract tests (`verification-http.spec.ts`: authenticated success,
  unauthenticated 401, wrong-role 403, invalid input 400, unknown target 404,
  document privacy assertions on the raw payload, audited decisions, audited
  document access, rejection + resubmission).
- Runtime smoke against the built app: application → approved provider →
  IDENTITY case → upload URL (signed) → disallowed content type 400 → submit →
  provider decision 403 → missing reason code 400 → admin approve →
  `/verification/me` shows no storage details → admin access URL (different
  signature) → `verification_level=IDENTITY` → two audit rows
  (data cleaned up afterwards).

### Deferred / known gaps

- **Spec gap**: `specs/05-api-spec.md` has no admin endpoint for reading a
  verification document, but `specs/12`/`specs/07` require permissioned and
  audited access. `POST /admin/verifications/:id/documents/:documentId/access-url`
  was added as the minimal audited path and should be ratified into the API spec.
- **Spec gap**: no verification-specific error code exists, so illegal
  transitions and invalid intake use `VALIDATION_ERROR` (400).
- The mock object-storage gateway is refused in production
  (`isMockAdapterAllowed`); a real private-bucket adapter is required before
  production use. The upload URL points at a mock base path
  (`OBJECT_STORAGE_BASE_URL`); no endpoint serves it yet.
- `verification_documents` are created when the upload URL is issued (the API
  spec defines no upload-confirmation callback), so a row can exist for an
  upload that never happened. Reaping such rows belongs to the lifecycle work
  in `specs/04-database-spec.md` §Data retention.
- `IdentityVerificationGateway` (`specs/03` §External provider ports:
  submit/query) is not implemented: V1 verification is an admin-reviewed
  evidence flow (`specs/12` §Provider review workflow).
- Teacher compliance (`TEACHER_COMPLIANCE` cases, `restriction_json`,
  orderability) is T007; capability-level approval is still not wired because it
  depends on compliance outcomes.
- Queue ordering implements "newest first" only: "risk flags first" and
  "incomplete cases first" (`specs/12`) need risk signals that do not exist yet
  (T018/T020).
- `GET /admin/verifications` does no pagination cursor; it is a bounded list
  (limit ≤ 100).
- Rate limiting on document intake is T022.

### Database impact

None. T006 uses the T002 `verification_cases`, `verification_documents` and
`audit_logs` tables as-is; no migration was added or modified.

## T007 — Teacher compliance

### Delivered

- New module `apps/api/src/modules/compliance/` (domain / application /
  infrastructure-free / http) owning the per-capability compliance state
  (`specs/06-verification-state-machine.md` §Teacher compliance).
- Admin review commands (ADMIN/OPS only, audited):
  `GET /admin/compliance` (newest-first queue of teacher capabilities),
  `POST /admin/compliance/:capabilityId/start-review`,
  `/approve`, `/restrict`, `/reject`, `/suspend` (all 200: state commands).
- Orderability gate: `TeacherComplianceService.assertOrderable(providerId,
  capabilityType, serviceContext)` — the single check T013 (orders) must call.
- Contract types added to `packages/api-contracts` (`compliance.ts`,
  `ENDPOINTS.adminCompliance`).
- Audit actions `COMPLIANCE_REVIEW_STARTED | COMPLIANCE_APPROVED |
  COMPLIANCE_RESTRICTED | COMPLIANCE_REJECTED | COMPLIANCE_SUSPENDED`.
- Provider-side: capability model, repository port and Prisma adapter gained
  `restriction_json`, `findById` and `listByComplianceStatus`; the profile
  repository gained `findManyByIds` so the queue never queries per row.

### Rules enforced

- **A teacher with pending compliance cannot be ordered** (acceptance
  criterion): `PENDING`, `UNDER_REVIEW`, `REJECTED` and `SUSPENDED` permit
  nothing; `assertOrderable` raises `FORBIDDEN` (403).
- **Identity/education approval is not sufficient** (`specs/06`): the gate reads
  only the compliance state, so a capability with `verification_level=FULL`
  stays unorderable while compliance is pending (covered by unit test and by
  E2E-03, which really approves an identity case first).
- **An approved teacher can only access the permitted service** (acceptance
  criterion): `APPROVED` permits every service; `RESTRICTED` permits only the
  services inside the granted scope — category (`allowedSubjectCodes`),
  location (`allowedCityCodes`) and/or time (`allowedUntil`), stored in
  `provider_capabilities.restriction_json` per `specs/06`. Allowlist semantics:
  every present dimension must match; a restriction with no dimension grants
  nothing, so `RESTRICTED` is never a blank cheque.
- **Configurable**: the scope is supplied per decision (admin payload, validated
  and normalized server-side) and the state machine is a data-driven transition
  table; no compliance rule is hard-coded in a controller.
- Compliance is separate from provider approval (T005) and from verification
  (T006): no command here changes `approval_status` or `verification_level`.
- Every decision carries a mandatory reason code (checked in the service, not
  only in the DTO) and writes one `audit_logs` row: actor, actor type, reason
  code, optional notes, target resource, before/after snapshot (including the
  restriction), IP hash and request id (`specs/06` §Admin decision
  requirements).
- Illegal transitions, decisions on capabilities that need no compliance and
  malformed restrictions are rejected before any write; unknown capability ids
  are `NOT_FOUND` (404).

### Tests

- Unit (28 new, 163 total in `apps/api`): transition matrix, terminal
  `NOT_REQUIRED`, re-entry after rejection, `requiresCompliance`; orderability
  for every state (pending/in review/rejected/suspended denied; approved
  allowed; restricted inside/outside the scope; expired time window; non-teacher
  never blocked; identity-approved-but-pending denied); restriction
  normalization (uppercase, dedupe, at-least-one-dimension, invalid code, bad
  timestamp), defensive parsing of stored JSON, allowlist matching; service
  commands (start review, approve clears the restriction, restrict stores the
  scope, reject → re-enter → approve, suspend, reason code required, wrong
  capability type, illegal transition, unknown id, queue listing and filtering);
  orderability gate through the service.
- Integration (15 new, 120 total): repository behaviour against PostgreSQL
  (`compliance-repository.spec.ts`: restriction persisted/cleared, queue by
  status and capability type, batched provider names, plus a `migration.spec.ts`
  assertion that `restriction_json` is `jsonb`) and HTTP contract tests
  (`compliance-http.spec.ts`: authenticated success, unauthenticated 401,
  wrong-role 403, invalid input 400, unknown target 404, audited approval and
  restriction, E2E-03 through the real provider + verification + compliance
  wiring, non-compliance capability never blocked).
- Runtime smoke against the built app: teacher application (capability starts
  `PENDING`) → provider decision 403 → unauthenticated 401 → admin queue →
  missing reason code 400 → approve → empty restriction 400 → restrict with a
  scope → two audit rows and the stored `restriction_json`
  (data cleaned up afterwards).

### Database impact

One migration: `prisma/migrations/20260929070000_teacher_compliance_restriction`
adds `provider_capabilities.restriction_json JSONB` (nullable). `specs/04-database-spec.md`
§provider_capabilities was updated to list it, because `specs/06` §Teacher
compliance names `restriction_json` while `specs/04` did not — the column is
required to make "approved teacher can only access permitted service" durable.
`pnpm prisma:migrate` applies it; the integration suite replays it from scratch.

### Deferred / known gaps

- **Spec conflict (reported, not silently resolved)**: `specs/06` names a
  `restriction_json` column that `specs/04` §provider_capabilities does not
  list. The column was added and `specs/04` updated accordingly.
- **Spec gap**: `specs/05-api-spec.md` §Admin defines no compliance route, but
  `specs/12-admin-spec.md` §Provider review workflow requires the reviewer to
  see "teacher compliance" and `specs/06` requires audited decisions. The five
  minimal admin commands above were added to satisfy T007 and should be ratified
  into the API spec.
- **Spec gap**: no compliance-specific error code exists. Illegal transitions and
  malformed restrictions use `VALIDATION_ERROR` (400); the orderability gate uses
  `FORBIDDEN` (403).
- **Open decision — `teacher_provider_enabled`**: `specs/03` lists the flag and
  `specs/10` asks for a "configurable teacher capability", but `specs/00`–`01`
  present the teacher provider as a V1 tutoring persona and the T002 seed
  defaults the flag to `false`, so enforcing it would disable teacher onboarding
  by default. T007 therefore does **not** gate the `TEACHER` capability behind
  it. Confirm whether the flag should gate onboarding (and whether the seed
  default should flip to `true`); this belongs with T019 flag management.
- Compliance here means "the restriction scope is configurable"; capability-level
  approval (`provider_capabilities.status`) is still not wired, so the orderability
  gate judges compliance only. T013 must still combine it with provider approval,
  published service (T009) and suspension.
- No provider-facing restriction view yet: `GET /providers/me` exposes
  `complianceStatus` but not the granted scope. If the teacher UI needs it, add a
  narrower DTO — the restriction must never reach public provider payloads
  (T010).
- `TEACHER_COMPLIANCE` remains an unused `verification_cases.verification_type`:
  compliance is decided on the capability, not through a verification case.
- Restriction evaluation needs the service facts (subject codes, city, time);
  T013 must resolve them from the service (T009) and pass them to the gate.
- Admin compliance queue has no pagination cursor and no risk ordering; it is a
  bounded list (limit ≤ 100), newest first.
- Rate limiting on admin/compliance endpoints is T022.

## T008 — Catalog

### Delivered

- Admin taxonomy management (`specs/05-api-spec.md` §Taxonomy):
  `GET /admin/taxonomy` (filters `type`/`parentId`/`active`, `page`/`pageSize`),
  `POST /admin/taxonomy`, `PATCH /admin/taxonomy/:id`,
  `POST /admin/taxonomy/:id/archive` (a state command: 200).
- Completed the `apps/api/src/modules/catalog/` module (T002 had left only the
  domain model and a read-only repository): domain policy, errors, application
  service, HTTP layer and module wiring (imports `AuthModule` + `AuditModule`).
- Contract types added to `packages/api-contracts` (`catalog.ts`:
  `TAXONOMY_TYPES`, `TaxonomyTermResponse`, `AdminTaxonomyListResponse`).
- Audit actions `TAXONOMY_CREATED | TAXONOMY_UPDATED | TAXONOMY_ARCHIVED`.
- Shared `common/http/request-ip.ts` (`hashRequestIp`); the three existing
  per-module copies (provider/verification/compliance) were collapsed onto it so
  the catalog is not a fourth copy.

### Rules enforced

- **Admin CRUD with audit** (acceptance criterion): every mutation writes one
  `audit_logs` row — actor, `actorType=ADMIN`, `resourceType=taxonomy_term`,
  target id, before/after snapshot, IP hash and request id
  (`specs/12-admin-spec.md`: "Every mutation audited", "No silent data edits").
  Reads are never audited; an empty patch or a repeated archive changes nothing
  and writes no row.
- **Archived, never deleted** (`specs/05-api-spec.md` §Taxonomy notes):
  `POST /admin/taxonomy/:id/archive` sets `active=false`; the port has no delete
  method at all, so `service_terms` references and historical order snapshots
  stay valid. Archive is idempotent.
- **Admin only**: every route requires ADMIN/OPS through `JwtAuthGuard` +
  `RolesGuard`; a plain user gets `FORBIDDEN` (403) and an anonymous caller
  `AUTH_REQUIRED` (401).
- **Stable codes**: `code` is normalized to an uppercase machine key
  (`^[A-Z0-9_]{1,64}$`, matching the seeded V1 taxonomy) and is immutable after
  creation — compliance restrictions (T007) and order snapshots reference codes.
  `(type, code)` is unique; a duplicate is `VALIDATION_ERROR` (400).
- **Tree integrity**: a parent must exist, must be of the same type, must be
  active, cannot be the term itself, and a move that would put a term under its
  own descendant is refused; the walk is depth-bounded (8).
- Responses are allowlist-mapped (`AGENTS.md` §10) and DTOs run under
  `forbidNonWhitelisted`, so `id`, `active` or `code` in a create payload is
  rejected with `VALIDATION_ERROR`. Unknown or malformed ids are `NOT_FOUND`
  (404) and never reach the database as a bad uuid.
- The listing is always bounded (`pageSize ≤ 100`) and reports `total`; ordering
  is `code`, then `id`, so paging never skips or repeats a row.

### Tests

- Unit (23 new, 186 total in `apps/api`): policy (code/name normalization and
  bounds, uuid detection, same-type parent, self-parent, archived parent,
  ancestor detection) and service (create normalization and audit, invalid
  payloads, `(type, code)` uniqueness across types, parent validation on create,
  same-type attachment, archived parent refusal, rename with before/after audit,
  empty patch is a no-op, move/detach, cycle refusal, archive + audit,
  idempotent archive, restore through a patch, unknown/malformed id, bounded
  filtered listing with `total`).
- Integration (14 new, 134 total): repository behaviour against PostgreSQL
  (`taxonomy-admin-repository.spec.ts`: create/read, partial update, archived
  terms stay resolvable, filters by type/parent/active, paging with a stable
  total, deterministic ordering) and HTTP contract tests
  (`taxonomy-admin-http.spec.ts`: authenticated success, unauthenticated 401,
  wrong-role 403, invalid input 400, duplicate 400, unknown/malformed target
  404, create→update→archive producing exactly three audit rows in order,
  idempotent archive, restore, filtered and paged listing).
- Runtime smoke against the built app: unauthenticated 401 → plain user 403 →
  admin create (code upper-cased) → duplicate 400 → invalid code 400 → patch →
  archive → archive again → restore → malformed id 404 → filtered listing →
  four `taxonomy_term` audit rows (data cleaned up afterwards).

### Database impact

None. T008 uses the T002 `taxonomy_terms` table and its `@@unique([type, code])`
and `@@index([type, active])` indexes as-is; no migration was added or modified.
The seed was left untouched (28 terms, all flat: no parent relations).

### Deferred / known gaps

- **Spec gap**: no public taxonomy read endpoint exists in `specs/05-api-spec.md`,
  so none was invented. T009 (service tagging) and T010 (search filters) read
  terms through the `TAXONOMY_REPOSITORY` port; if the mini program needs a
  filter-options endpoint, it must be added to the API spec first.
- **Spec gap**: `PATCH /admin/taxonomy/:id` fields are not enumerated by the
  spec. Implemented as `name`, `parentId` and `active`; `code` is immutable.
  `active` in a patch is the only recovery from an archive, because the spec
  defines an archive command but no restore endpoint — confirm whether a
  dedicated restore route should be added to the spec instead.
- **Spec gap**: no catalog-specific error code exists, so invalid payloads,
  illegal parents and duplicate codes use `VALIDATION_ERROR` (400).
- Archiving a parent does not touch its children (the spec defines no cascade):
  a child of an archived parent stays active. T009/T010 must require *active*
  terms when tagging or filtering if that is the desired behaviour.
- Terms in use by published services can be archived; the spec does not forbid
  it. A guard (or a warning) belongs with T009, once `service_terms` exists.
- No taxonomy seed hierarchy: all 28 seeded terms are roots, so parent features
  are only exercised by tests. Real hierarchies (province→city, subject→topic)
  are a content decision for T019 admin configuration.
- `city_code`/`grade`/`subject` values supplied elsewhere (provider profile,
  child grade) are still format-validated only; they are not resolved against
  `taxonomy_terms` yet. Resolution belongs to T009/T010, which can now use the
  taxonomy port.
- Admin taxonomy pages in `apps/admin` are T019; rate limiting is T022.

## T009 — Services

### Delivered

- Provider service endpoints (`specs/05-api-spec.md` §Services):
  `POST /providers/me/services`, `GET /providers/me/services`,
  `PATCH /providers/me/services/:id`,
  `POST /providers/me/services/:id/publish`,
  `POST /providers/me/services/:id/unpublish` (both state commands: 200).
- New module `apps/api/src/modules/services/` (domain / application /
  infrastructure / http), the Service aggregate of `specs/02-domain-model.md`.
- Contract types added to `packages/api-contracts` (`services.ts`:
  `SERVICE_STATUSES`, `SERVICE_DOMAINS`, `ServiceResponse`,
  `ServiceTermResponse`, `ProviderServiceListResponse`) and
  `ENDPOINTS.providerServices`.
- The real `SERVICE_READINESS` adapter
  (`infrastructure/prisma-service.readiness.ts`) replaces the T005
  `DeferredServiceReadiness` stub, which was deleted. The provider context still
  depends only on the port — same shape as the verification gate (T006) — and
  the two T006/T007 integration suites now bind the real adapter.
- `ProviderServiceService.assertOrderable(serviceId)` returns the order facts
  (price, duration, subject codes, city code) for T013 and raises
  `SERVICE_NOT_PUBLISHED` (409) otherwise.

### Rules enforced

- **Server validates price/duration** (acceptance criterion): both are validated
  in the domain policy, not in a controller and never by a client. Price is an
  integer in minor units (`AGENTS.md` §8) inside `[100, 1_000_000]`; duration is
  a whole number of minutes inside `[15, 480]`; the title is bounded (120) and
  the description (2000). The DTO rejects the same values at the boundary
  (`@IsInt`, `@Min`, `@Max`), so a float price never reaches the domain.
- **Publish state machine** (acceptance criterion): only `SERVICE_TRANSITIONS`
  may run (`DRAFT|REJECTED|UNPUBLISHED -> PUBLISHED`,
  `PUBLISHED -> UNPUBLISHED`), the check happens before any write, and a repeated
  command is refused. A new service is always created as `DRAFT`; a published
  service cannot be edited — unpublish first, because a published service is what
  a customer sees and what an order snapshots.
- **No publishing before approval**: `publish` calls T005's single
  `assertCanPublish`, so an unapproved provider gets `PROVIDER_NOT_APPROVED`
  (409) and a provider can never publish itself into the marketplace.
- **Publication drives discovery**: after every publish/unpublish the provider
  `searchable` flag is recomputed from all gates (account active + approved +
  verification (T006) + published service), so E2E-02
  ("…service publish -> discoverable") really flips, and unpublishing takes the
  provider back out of discovery.
- **Prices and status are server-owned**: there is no `status`, `domain`,
  `providerId`, `id` or `cancellationPolicyId` in any DTO and the global
  `ValidationPipe` runs with `forbidNonWhitelisted`, so `"status": "PUBLISHED"`
  in a create payload is rejected. `domain` follows
  `provider_profiles.provider_type`.
- **Tags are resolved, not trusted**: a client supplies taxonomy *codes*
  (`subjectCodes`/`gradeCodes`/`skillCodes`/`cityCodes`); the server normalizes
  them the way the taxonomy does, resolves them through the
  `TAXONOMY_REPOSITORY` port and refuses unknown or archived terms, storing only
  term ids in `service_terms`. A tutoring service must name at least one subject.
- Ownership: another provider's service is `FORBIDDEN` (403); an unknown or
  malformed id is `NOT_FOUND` (404) and never reaches the database as a bad uuid.
  Creating a service without a provider application is `NOT_FOUND` (404).
- Responses are allowlist-mapped (`AGENTS.md` §10): terms are emitted with type
  and code; nothing private or internal is serialized.

### Tests

- Unit (26 new, 212 total in `apps/api`): policy (duration and price bounds and
  integer checks, title/description/currency normalization, code normalization
  and per-type limit, the subject rule, the full transition table, editability,
  `isPublished`) and service (create as `DRAFT` with resolved tags,
  price/duration/title/currency/description validation, unknown and archived
  codes, subject requirement, career domain needs no subject, no application →
  404, per-provider listing, partial tag updates keeping the other types,
  "cannot edit a published service" and the unpublish→edit path, publish refused
  before approval, publish/unpublish discipline with `searchable` flipping both
  ways, a provider staying hidden while verification is missing, foreign/unknown
  ids, and the order-facts gate).
- Integration (10 new, 144 total): repository behaviour against PostgreSQL
  (`services-repository.spec.ts`: create with tags and the `service_terms` rows
  behind it, per-provider listing, partial update with whole-tag replacement
  inside one transaction, `setStatus` plus the discovery gate) and HTTP contract
  tests (`services-http.spec.ts`: authenticated success, unauthenticated 401 on
  all five routes, invalid input 400 for every price/duration/tag/status case,
  404 without an application, list/edit, another provider's service 403,
  unknown/malformed id 404, publish before approval 409, then
  submit → admin approve → publish → `searchable=true`, editing a published
  service refused, publishing twice refused, unpublish → `searchable=false`).
- Runtime smoke against the built app: unauthenticated 401 → no application 404
  → application → create (lower-case `math` resolved to `MATH`) → price 99,
  duration 600, unknown code and a client `status` field all 400 → list → patch
  → publish before approval 409 → submit → admin approve → publish 200 →
  edit published 400 → publish again 400 → unpublish → malformed id 404; with
  identity/education approved, `searchable` flipped `true` on publish and
  `false` on unpublish (data cleaned up afterwards).

### Database impact

None. T009 writes the T002 `services` and `service_terms` tables (indexes
`services(provider_id, status)` and `service_terms(term_id, service_id)` already
exist); no migration was added or modified.

### Deferred / known gaps

- **Spec gap**: `PENDING_REVIEW` and `REJECTED` are in `services.status` and in
  the state machine of `specs/06`, but V1 has no admin service-review endpoint
  (the API spec lists provider routes only and `specs/12` only audits a "service
  publication override"), so the self-service publish command goes straight to
  `PUBLISHED`. If a review step is wanted, the endpoint must be added to the API
  spec first and the decision must be audited.
- **Spec gap**: no service-specific conflict code exists, so illegal transitions
  and "cannot edit a published service" use `VALIDATION_ERROR` (400).
- **Policy decision to ratify**: the numeric bounds (price `100..1_000_000`
  minor units, duration `15..480` minutes, ≤ 20 tags per type, one subject
  required for tutoring) are configuration chosen here because no spec states
  them. They live in one place (`domain/service-policy.ts`) and should move to
  T019 platform rules.
- `cancellationPolicyId` is never written: refund policy is T016.
- Provider self-service service mutations write no audit rows: `specs/12` audits
  admin/privileged mutations (including a "service publication override"), not a
  provider editing its own draft. An admin service moderation command (T019)
  must be audited.
- `GET /providers/:id/services` (the public list) is T010, which owns "only
  discoverable providers". Watch route ordering when it is added:
  `/providers/me/services` must be registered before any `/providers/:id/...`
  route or `me` will be parsed as an id.
- Availability (T011), order price snapshots (T013) and discovery filters (T010)
  still have to be built on top of this aggregate; `assertOrderable` here only
  judges the service — T013 must still combine it with provider approval (T005)
  and teacher compliance (T007).
- No pagination on `GET /providers/me/services` (the spec defines no query for
  it); a provider owns a small, bounded set of services.
- A service may keep a tag whose term is archived afterwards (T008 does not
  cascade). Discovery (T010) must filter on active terms.
- Career services are reachable only through a career provider, which itself
  requires the feature flag (T005); the career service model (T021) is not
  modelled here beyond `domain` and the missing-subject exemption.

## T010 — Discovery

### Delivered

- Public discovery endpoints (`specs/05-api-spec.md` §Provider):
  `GET /providers` (filters `domain`, `city`, `providerType`, `subject`,
  `grade`, `deliveryMode`, `minPrice`, `maxPrice`, `verifiedOnly`, `page`,
  `pageSize`, `sort`), `GET /providers/:id`, `GET /providers/:id/services`.
  All three are readable with or without a session (`OptionalJwtAuthGuard`).
- New module `apps/api/src/modules/discovery/` (domain / application /
  infrastructure / http) with a single read port, `PROVIDER_DIRECTORY`.
- Contract types added to `packages/api-contracts` (`discovery.ts`:
  `PROVIDER_SORTS`, `PublicProviderResponse`, `ProviderSearchItemResponse`,
  `ProviderSearchResponse`, `ProviderDetailResponse`,
  `PublicProviderServiceListResponse`).
- Shared row mappers so a column is mapped in one place:
  `provider/infrastructure/provider-row.mapper.ts` (profile + capability) and
  `services/infrastructure/service-row.mapper.ts` (service + tags), now used by
  the T005/T007 repositories, the T009 repository and the T010 read model.

### Rules enforced

- **Only discoverable providers** (acceptance criterion): the gate lives in one
  `where` inside `PrismaProviderDirectory` — `searchable = true` **and**
  `approvalStatus = APPROVED` **and** an active, undeleted account — so no
  filter combination can widen it. A provider that is merely approved, or one
  with a published service on a suspended account, is not listed and its detail
  route is `NOT_FOUND` (404), the same answer as an unknown id: nothing about
  *why* a provider is hidden leaks (`specs/01-business-rules.md` §Provider
  approval, `specs/13-security-spec.md`).
- **Private fields excluded** (acceptance criterion): the public payload is a
  per-field allowlist (test asserts the exact key set). Never serialized:
  `userId`, `approvalStatus`, `searchable`, `avatarVisibility`, capability
  `status`, `complianceStatus` and the `restriction_json` scope of a restricted
  teacher (T007), any contact data, any identity document. A capability is
  narrowed to `capabilityType` + `verificationLevel`, and a private photo is
  simply `null` (`specs/01` §Student tutor: "Photo: optional, visibility
  configurable"; `specs/10-privacy-and-minors.md`).
- **Published services only**: `GET /providers/:id` and the service route read
  `status = 'PUBLISHED'` services; a draft is never public even for a
  discoverable provider (`specs/06` §Service publication).
- **Bounded and deterministic**: `page` ≥ 1, `pageSize` ∈ `[1, 50]` (default 20),
  `total` counts every match, and every ordering ends with `id asc` so paging
  never skips or repeats a row. Price filters are integer minor units, bounded
  and rejected when `minPrice > maxPrice`.
- **Filters are hard constraints** (`specs/16-ai-matching-spec.md` §Retrieval):
  city, capability type, verification (`verificationLevel = FULL`), subject and
  grade (both tags on the same service), delivery mode and price range. Codes
  are upper-cased, so a filter typed in any case matches.
- **Ranking is a retrieval ordering** (`specs/01-business-rules.md` §Ranking):
  after the hard filters, `relevance` orders by rating count → rating → completed
  orders → recency; `rating` and `newest` are explicit alternatives. It is never
  presented as a quality score.
- **Feature flag**: a `CAREER` listing is empty and a career provider detail is
  404 while `career_marketplace_enabled` is off (`AGENTS.md` §7).
- Read model only: discovery never writes and never decides state; the provider
  (T005), verification (T006), compliance (T007) and service (T009) contexts own
  the gates and this module only reads their result.

### Tests

- Unit (14 new, 226 total in `apps/api`): policy (bounded defaults, code and
  enumeration normalization, paging bounds, price bounds and impossible range,
  unknown `domain`/`providerType`/`deliveryMode`/`sort`, malformed code, a
  non-uuid id is `NOT_FOUND`) and service (query normalization before it reaches
  the directory, the exact public field set, private photo stays null, the career
  marketplace hidden without ever asking the directory and searched once the flag
  is on, `NOT_FOUND` for unknown/malformed/hidden with no database round-trip for
  a malformed id, published services on the detail route).
- Integration (16 new, 160 total): the read model against PostgreSQL
  (`discovery-directory.spec.ts`: only discoverable providers, city/subject/
  grade/delivery/price/capability/verified filters, tag pair on one service,
  cheapest published price, deterministic paging with a stable `total`, rating and
  recency ordering, `null` for hidden/suspended/unknown/malformed) and HTTP
  contract tests (`discovery-http.spec.ts`: anonymous success, no private or
  workflow field anywhere in the raw payload, exact item key set, filters
  end-to-end, detail and service route with published services only, 404 matrix,
  invalid query 400 matrix, `/providers/me` still `AUTH_REQUIRED` so route order
  is safe, career listing empty while the flag is off).
- Runtime smoke against the built app: anonymous list, filtered list
  (`subject=math` hit / `subject=english` empty / price ranges), published
  service after approve + verify + publish flipping `searchable=true`, the
  unapproved provider absent, detail and service routes, hidden provider 404,
  unknown and malformed id 404, `pageSize=51` and unknown `sort` 400,
  `domain=CAREER` empty (data cleaned up afterwards).

### Database impact

None. T010 reads the T002 tables (`provider_profiles` with the
`searchable, approval_status, city_code` index, `provider_capabilities`,
`services`, `service_terms`, `taxonomy_terms`); no migration was added or
modified.

### Deferred / known gaps

- **Spec gap**: `specs/05-api-spec.md` names `sort` but not its values, and no
  spec defines the page-size bound: `relevance | rating | newest` and
  `pageSize ≤ 50` were chosen here. **Price sorting is deliberately absent**: the
  service price lives on `services`, so ordering providers by it needs either a
  denormalized column or a raw aggregate query — ratify one before adding
  `price_asc`/`price_desc` (T019/T020).
- **Ranking is incomplete by design**: `specs/01` §Ranking also names service
  availability (T011) and price-range fit. The former has no data yet, the latter
  is applied as a filter, not as a score.
- **Spec gap**: no discovery-specific error code exists, so an invalid query uses
  `VALIDATION_ERROR` (400) and a hidden provider uses `NOT_FOUND` (404).
- **Route ordering** (also noted by T009): `GET /providers/me`,
  `GET /providers/me/services` and now `GET /providers/:id` share a prefix, so
  `ProviderModule` (and `ServicesModule`) must stay registered before
  `DiscoveryModule` in `AppModule`. Covered by a test; a shared route prefix or
  an explicit guard would be sturdier.
- `verifiedOnly` is interpreted as `verificationLevel = FULL` (identity **and**
  education approved, T006). If "verified" should mean identity only, say so and
  the mapping changes in one place.
- Filtering does not require the taxonomy term to be *active*: a service keeps a
  tag whose term is archived later (T008 does not cascade), and such a service
  still matches. Decide with T019 whether archived tags should be excluded here.
- Rating, completed-order and recency signals are still all zero/default: reviews
  (T017) and orders (T013) have to write them before ranking is meaningful.
- No caching: every listing is at most three queries (count, page, cheapest-price
  aggregate), but a public search endpoint should be cached and rate limited
  (T022 owns both; `specs/13-security-spec.md` asks for rate limiting on public
  search).
- Discovery UI states (loading/empty/error/retry), the mini-program Discover tab
  and the admin "public profile preview" are T019.

## T011 — Availability

### Delivered

- Provider availability endpoints (`specs/05-api-spec.md` §Availability):
  `POST /providers/me/availability` (201), `DELETE /providers/me/availability/:id`
  (200, `{ id, deleted }`) and `GET /providers/:id/availability` (public,
  bounded, future open slots only).
- New module `apps/api/src/modules/availability/` (domain / application /
  infrastructure / http) with the `AVAILABILITY_SLOT_REPOSITORY` port.
- Booking invariant for T013: `AvailabilityService.claim({ providerId, startAt, endAt })`
  books the slot covering the window and `release(...)` gives it back
  (`BOOKED -> OPEN`) for cancellations (T016).
- Contract types added to `packages/api-contracts` (`availability.ts`:
  `AVAILABILITY_STATUSES`, `AvailabilitySlotResponse`, `AvailabilityListResponse`,
  `AvailabilityDeletionResponse`) and `ENDPOINTS.providerAvailability`.
- One migration: `20260930123000_availability_slots_no_overlap` — a GiST
  exclusion constraint over `(provider_id, tsrange(start_at, end_at, '[)'))`.
  `specs/04-database-spec.md` §availability_slots now documents the invariant.

### Rules enforced

- **No overlapping confirmed bookings** (acceptance criterion), in three layers:
  1. two slots of one provider never overlap — the repository checks the window
     inside the insert transaction, and the database exclusion constraint is the
     last line of defence (verified by a direct SQL insert in the smoke test);
  2. a booking consumes exactly one whole slot, so a booked slot is no longer
     `OPEN` and can never be handed out twice;
  3. the claim itself is a single conditional UPDATE
     (`WHERE id = ? AND status = 'OPEN'`), so two concurrent bookings of the same
     window produce exactly one winner.
- **Race condition test** (acceptance criterion): `availability-repository.spec.ts`
  fires two concurrent `claimByRange` calls and two concurrent overlapping
  `create` calls against real PostgreSQL and asserts exactly one winner in both
  cases; the service-level test asserts the loser gets `VALIDATION_ERROR`, never a
  double booking.
- **Server-side window validation**: real ISO-8601 dates, `endAt > startAt`,
  15–1440 minutes, never in the past. Touching windows are allowed (half-open
  ranges), containment and partial overlap are not.
- **A confirmed booking keeps its slot**: `DELETE` refuses a `BOOKED` slot and the
  delete itself is conditional (`WHERE status = 'OPEN'`), so a slot cannot be
  removed underneath a booking that was confirmed concurrently.
- **Public listing follows discovery (T010)**: `GET /providers/:id/availability`
  answers `NOT_FOUND` for a provider that is not discoverable, and lists only
  future `OPEN` slots — never `BOOKED` ones, never past ones, always bounded.
- Ownership: another provider's slot is `FORBIDDEN` (403); an unknown or malformed
  id is `NOT_FOUND` (404) and never reaches the database as a bad uuid. The
  self-service routes require a session; the public listing does not.
- Responses are allowlist-mapped (`AGENTS.md` §10); timestamps are ISO-8601 UTC.

### Tests

- Unit (16 new, 242 total in `apps/api`): policy (valid window, every invalid
  window, past slot, recurrence normalization, half-open overlap including
  containment, overlap only against `OPEN`/`BOOKED`) and service (create for the
  provider behind the session, window validation, overlap refusal with touching
  windows allowed, listing only future open slots, hidden provider → 404, delete
  own open slot, a booked slot survives a delete, foreign/unknown ids, and the
  booking flow: exactly one of two concurrent claims wins, a window no slot
  covers is refused, release gives the window back).
- Integration (15 new, 175 total): repository behaviour against PostgreSQL
  (`availability-repository.spec.ts`: create/read/list with filters, overlap
  refused by the application *and* by the constraint, **the two race tests**,
  release, delete-only-open) plus HTTP contract tests
  (`availability-http.spec.ts`: unauthenticated 401 on both self-service routes
  while the public listing is 200, create 201, the public listing closed while
  the provider is not discoverable, invalid window 400 matrix, overlap 400,
  booked and past slots never listed, hidden provider 404, delete 200 → 404,
  booked delete 400, foreign 403, unknown/malformed 404) and a new
  `migration.spec.ts` assertion that the exclusion constraint exists.
- Runtime smoke against the built app: create slot 201 → public listing 404 while
  not discoverable → approve + verify + publish → listing 200 → overlapping slot
  400 → end-before-start 400 → past slot 400 → unauthenticated 401 → delete 200 →
  delete again 404; then a direct SQL insert of an overlapping slot was rejected
  by `availability_slots_no_overlap` (data cleaned up afterwards).

### Database impact

One migration: `prisma/migrations/20260930123000_availability_slots_no_overlap`
adds the GiST exclusion constraint and `CREATE EXTENSION IF NOT EXISTS
btree_gist`. `specs/04-database-spec.md` §availability_slots was updated to
document the invariant. No table or column was added.

### Deferred / known gaps

- **Spec gap**: `specs/05-api-spec.md` defines no availability error code, so an
  overlap, an invalid window and "already booked" all use `VALIDATION_ERROR`
  (400). A `SLOT_UNAVAILABLE` code would read better in T013.
- **Deployment prerequisite**: the migration needs the `btree_gist` contrib
  extension (present in `postgres:16` and locally). On a managed PostgreSQL it
  must be allow-listed; confirm before the first production deploy.
- **V1 scope**: `recurrence_rule` is stored verbatim and never expanded, and there
  is no slot update endpoint — both are V1.1 (`specs/00-product-spec.md`).
  A booking therefore books one *stored* slot; recurring slots must be expanded
  into rows by whoever creates them.
- **Booking granularity**: an order books a whole slot. A shorter session inside a
  longer slot is not modelled, and the V1 `orders` table has no `slot_id`, so
  T013 must keep the window it claimed in order to release it later.
- `BLOCKED` slots are stored but nothing sets them yet: V1 has no "time off"
  endpoint, and blocking inside an open slot is deliberately allowed (it is never
  bookable anyway).
- The public listing has no `from`/`to` query and no pagination cursor: it is a
  bounded list of the next 100 open slots (`specs/05-api-spec.md` defines no query
  for it). T019 may need a date range.
- Availability is not part of discovery ranking yet (`specs/01` §Ranking #5): T010
  filters and ranks without it. Wiring "has a bookable slot" into the listing is a
  follow-up that should reuse this module.
- No audit log for self-service slot changes: `specs/12-admin-spec.md` audits
  admin/privileged mutations, not a provider editing their own calendar.
- Deleting a slot is a hard delete (the table has no `deleted_at`); a booked slot
  is protected, so no booking history is lost.

## T012 — IM adapter

### Delivered

- Messaging endpoints (`specs/05-api-spec.md` §Messaging):
  `POST /conversations` (201), `GET /conversations` (bounded, newest first),
  `GET /conversations/:id`, `POST /conversations/:id/report` (201),
  `POST /users/:id/block` (201), `DELETE /users/:id/block` (200).
- New module `apps/api/src/modules/messaging/` (domain / application /
  infrastructure / http) with three ports: `CONVERSATION_REPOSITORY`,
  `BLOCK_REPOSITORY`, `MODERATION_REPOSITORY`.
- `MessagingGateway` — the IM adapter port, exactly the shape of
  `specs/03-architecture-spec.md` §External provider ports
  (`createConversation`, `sendSystemMessage`, `blockUser`) — plus
  `MockMessagingGateway` for local/development/test, which production refuses
  (same rule as the T003/T006 mocks). The domain never imports a vendor SDK and
  never stores message content.
- Server-side system messages: `ConversationService.sendSystemMessage(...)` sends
  template code + params through the transport; no route yet, because the events
  that trigger them (order created, payment succeeded, booking confirmed,
  cancellation, refund, review reminder) are T013–T017.
- Contract types added to `packages/api-contracts` (`im.ts`,
  `moderation.ts`: `REPORT_REASON_CODES`, `MODERATION_TARGET_TYPES`,
  `MODERATION_CASE_STATUSES`, conversation/block/report payloads) and
  `ENDPOINTS.conversations`.

### Rules enforced

- **Block prevents new chat** (acceptance criterion): a block is stored
  one-directionally but blocks messaging in *both* directions —
  `ConversationService` asks `existsBetween` and raises `BLOCKED_USER` (403).
  Blocking also freezes the pair's existing conversations (`OPEN -> BLOCKED`)
  rather than deleting them, so a moderator keeps the history, and it tells the
  transport (`gateway.blockUser`) so delivery stops outside our database too.
  Unblocking re-opens what the block froze and nothing else: a `CLOSED`
  conversation stays closed.
- **Report creates a moderation case** (acceptance criterion): a report of a
  conversation writes `reports` (intake, `PENDING`) **and** a `moderation_cases`
  row (`REPORT`, `OPEN`, `source_report_id`) in one transaction. Per
  `specs/04-database-spec.md` there is at most one *active* case per target, so a
  second report of the same conversation reuses the open case and reports
  `caseCreated: false`; a new case appears again only once the previous one is
  resolved.
- **Conversation creation gates** (`specs/09-im-spec.md` §Conversation
  creation): both accounts active and not deleted, no block in either direction,
  and — when the conversation is about a provider — that provider must be
  discoverable (T010 decides it, messaging never re-decides). A provider that is
  not part of the conversation is refused.
- **Membership is the only read permission**: a non-member, an unknown id and a
  malformed id all answer `NOT_FOUND`, so a conversation id cannot be probed
  (`specs/13-security-spec.md`).
- **No message content, no contact data**: the response carries members and
  message *references* only, and never `providerConversationId`; system messages
  send a template code plus params, never rendered personal data
  (`specs/09` §Message policy, `specs/04` §notifications).
- Bounded listings (`pageSize ≤ 50`, default 20) with `total` counting every
  match.

### Tests

- Unit (15 new, 257 total in `apps/api`): policy (self-chat, paging bounds,
  report description normalization, which moderation statuses count as active)
  and services (create through the gateway with the platform id, provider side
  marked `PROVIDER`, a non-discoverable provider refused with nothing created,
  self/missing peer refused, listing and reading limited to members, system
  messages only through an open conversation and only as template + params,
  **report creates a case and a second report reuses it**, a non-member cannot
  report; block tells the transport and freezes conversations, blocks new
  conversations in both directions with `BLOCKED_USER`, unblock re-opens only
  what was frozen, self-block and unknown accounts refused).
- Integration (12 new, 187 total): repository behaviour against PostgreSQL
  (`messaging-repository.spec.ts`: conversation + both members in one write,
  per-user paged listing with a stable `total`, freeze/re-open of a pair, an
  idempotent block read in both directions, report + case in one transaction
  including the "at most one active case" rule before and after a resolution) and
  HTTP contract tests (`messaging-http.spec.ts`: unauthenticated 401 on every
  route, create 201 about a discoverable provider with no transport id in the
  payload, invalid payloads 400 including a client-supplied `status`, **block →
  `BLOCKED_USER` in both directions with the conversation frozen**, unblock →
  messaging works again, **report → 201 with a stored `REPORT|CONVERSATION|OPEN`
  case and a `PENDING` report**, a second report reusing the case, non-member read
  and report 404, invalid report payload 400).
- Runtime smoke against the built app: unauthenticated 401 → conversation 201
  (members `PROVIDER`/`BUYER`, no transport id) → list and detail → block 201 →
  new conversation 403 `BLOCKED_USER` from both sides → conversation `BLOCKED` →
  unblock 200 → new conversation 201 → report 201 with a `REPORT|CONVERSATION|OPEN`
  case and a `HARASSMENT|PENDING` report (data cleaned up afterwards).

### Database impact

None. T012 writes the T002 tables (`conversations`, `conversation_members`,
`blocks`, `reports`, `moderation_cases`); no migration was added or modified and
`message_refs` stays empty by design.

### Deferred / known gaps

- **`message_refs` has no writer in V1**: the port's `sendSystemMessage` returns
  `void`, and there is no send-message route in
  `specs/05-api-spec.md` (transport is the adapter's). The column
  `sender_user_id` is a NOT NULL FK to `users`, so even a system message would
  need a system account. Decide with T018 (message moderation) whether refs are
  persisted and who the sender of a system message is.
- **Anti-spam limits are not enforced**: `specs/09` lists "anti-spam limits
  pass" as a creation condition. Rate limiting for new conversations and messages
  is T022 (`specs/13-security-spec.md`).
- **`im_enabled` is not enforced**: the flag exists in
  `specs/03-architecture-spec.md` and the T002 seed defaults it to `false`, so
  gating messaging behind it would disable chat by default (the discovery journey
  in `specs/00` includes chat). Same open decision T007 raised for
  `teacher_provider_enabled`: confirm with T019 flag management.
- **No `unblockUser` in the port**: `specs/03` defines only `blockUser`, so
  unblocking removes our row and re-opens conversations but cannot tell the
  transport. Add it to the port if the vendor needs it.
- **No block list, no message send/read route**: `specs/05-api-spec.md` defines
  none; inventing them was out of scope. `GET /me/reports` and `POST /reports`
  (general intake) are T018.
- **Moderation workflow is T018**: this module only intakes. Severity is left
  `null`, no moderator is assigned, and no admin decision or audit row is written
  here — `specs/12-admin-spec.md` audits moderation *actions*, and
  `specs/04` requires an audited appeal path with an independent reviewer.
- No idempotency key on conversation creation or reports
  (`specs/03` §Idempotency lists neither), so a retried request creates another
  conversation/report.
- Conversations are not attached to orders yet: `orders` and its lifecycle are
  T013, and `conversations.order_id` stays `null` until then.
- `GET /conversations` has no filter and no cursor: it is a bounded, newest-first
  page, as the spec defines no query for it.

## T013 — Orders

### Delivered

- Order endpoints (`specs/05-api-spec.md` §Orders): `POST /orders` (201),
  `GET /orders` (bounded, newest first), `GET /orders/:id`, and the four state
  commands `POST /orders/:id/cancel|confirm|start|complete` (200).
- New module `apps/api/src/modules/orders/` (domain / application /
  infrastructure / http) with the `ORDER_REPOSITORY` port.
- Shared idempotency: `IDEMPOTENCY_STORE` port +
  `InMemoryIdempotencyStore` under `common/idempotency/`, used by
  `POST /orders` through the `Idempotency-Key` header of
  `specs/03-architecture-spec.md` §Idempotency.
- Contract types added to `packages/api-contracts` (`orders.ts`:
  `ORDER_STATUSES`, `OrderResponse`, `OrderPriceSnapshotResponse`,
  `OrderListResponse`) and `ENDPOINTS.orders`.
- `ProfileModule` now also exports `CHILD_PROFILE_REPOSITORY`, so the order
  context checks guardian ownership through the port instead of the table.

### Rules enforced

- **Server calculates the total** (acceptance criterion): `amountMinor` comes
  from the published service price, `platformFeeMinor` from the fee rule
  (10.00% in basis points, rounded down, never more than the order) and
  `providerAmountMinor` is the remainder — all integer minor units
  (`AGENTS.md` §8). The fee version and rate travel with the order in
  `policy_snapshot`, and the service price/duration in `price_snapshot`, so a
  later price or rule change never rewrites an order.
  A client that sends `amountMinor`, `priceMinor`, `platformFeeMinor` or
  `providerId` is rejected by `forbidNonWhitelisted` with `VALIDATION_ERROR`.
- **No direct status PATCH** (acceptance criterion): there is no update route
  and no status field in any DTO. Every transition is looked up in
  `ORDER_TRANSITIONS` (`specs/06-verification-state-machine.md` §Order) and an
  illegal one answers `ORDER_INVALID_STATE` (409). `cancel` belongs to the buyer
  and only while unpaid; `confirm`, `start` and `complete` belong to the
  provider that delivers the order; `PAID` is left to the payment context
  (T014), `REFUND_PENDING`/`REFUNDED` to refunds (T016) and `DISPUTED` to
  moderation (T018). "Order cannot become COMPLETED before PAID" holds by
  construction: `COMPLETED` is only reachable from `IN_PROGRESS`.
- **Every gate of `specs/01-business-rules.md` §Orders runs before a write**:
  published service (T009 `assertOrderable`), discoverable provider (T010
  directory, so an active and approved provider with a published service),
  active buyer who is not the provider, a child that belongs to the buyer and is
  not deleted (T004), teacher compliance for **every** capability of the
  provider (T007 gate, with the service subject/city/time), and valid
  availability — the claimed slot (T011) decides `scheduled_start`/`end`, so a
  client cannot book a window the provider never offered.
- If the order cannot be written, the claimed slot is released again, so a
  failed booking never blocks a time.
- Cancelling an unpaid order releases the slot: the time becomes bookable again.
- Idempotency: the same `Idempotency-Key` replays the same order; the same key
  with a different payload is `IDEMPOTENCY_CONFLICT` (409).
- Participation is the only read permission: a stranger, an unknown id and a
  malformed id all answer `NOT_FOUND`, so an order id cannot be probed.

### Tests

- Unit (19 new, 276 total in `apps/api`): policy (transition matrix including
  the "not COMPLETED before PAID" and "no cancel after payment" rules, terminal
  and paid predicates, fee arithmetic with edge amounts and non-integer
  rejection, order-number format, window validation, note and paging bounds) and
  service (create with the server's money and the slot's schedule, compliance
  checked per capability, unpublished service → `SERVICE_NOT_PUBLISHED` 409,
  hidden provider → 404, self-order and inactive buyer → 400, foreign/deleted
  child → 400, compliance refusal → 403, slot released when the write fails,
  idempotent replay and conflict, listing/reading limited to the parties,
  commands: provider cannot confirm unpaid, buyer cannot advance, the
  `PAID → CONFIRMED → IN_PROGRESS → COMPLETED` path, terminal states, buyer
  cancel frees the slot, no cancel after payment).
- Integration (12 new, 199 total): repository behaviour against PostgreSQL
  (`orders-repository.spec.ts`: create unpaid, read by id and order number,
  snapshots stored as jsonb and read back, paged listing for buyer and provider,
  status commands) and HTTP contract tests (`orders-http.spec.ts`:
  unauthenticated 401 on every route, create 201 with the server's money and the
  slot turning `BOOKED`, a second booking of the same slot refused, any
  client-supplied money/status rejected 400, gate breakages (past/impossible
  window, malformed and unknown service, foreign child, hidden provider 404,
  pending teacher compliance 403), idempotent replay and `IDEMPOTENCY_CONFLICT`,
  listing/reading for the parties only, the full command path with illegal
  transitions 409, cancel → `CANCELLED` with the slot back to `OPEN`).
- Runtime smoke against the built app: unauthenticated 401 → slot → order 201
  (20000 / 2000 / 18000, slot `BOOKED`) → client `amountMinor` 400 → idempotent
  replay (same order id) → reuse with another payload 409 → confirm before
  payment 409 → buyer confirm 403 → confirm/start/complete → complete again 409
  → cancel frees the slot → cancel again 409 → unknown/malformed order 404
  (data cleaned up afterwards).

### Database impact

None. T013 writes the T002 `orders` table (indexes `buyer_user_id, created_at`,
`provider_id, created_at`, `status, scheduled_start` already exist); no
migration was added or modified.

### Deferred / known gaps

- **`note` is accepted but not persisted**: `specs/05-api-spec.md` lists it in
  the order input, but `specs/04-database-spec.md` §orders has no column for it.
  T013 validates it (≤ 500 characters) and drops it; either add the column
  (migration + spec update) or remove it from the API.
- **Fee configuration is a constant**: 10.00% (`PLATFORM_FEE_RATE_BPS`) with
  version `platform-fee-v1`. It must move to published platform rules
  (`specs/12-admin-spec.md` §Platform configuration, T019); the version is
  already recorded per order so a change is auditable.
- **Idempotency is in-memory**: correct for one instance and for tests, wrong
  for a multi-instance deployment. The durable Redis-backed store is T022
  (`AGENTS.md` §5); the port is what the application depends on.
- **`PAID` has no route**: payment (T014) will call the order context; until
  then tests set the state directly (a documented test seam, the same pattern
  T011 used for slot claims).
- Cancelling a *paid* order is deliberately not a transition: it goes through
  `REFUND_PENDING` in T016. There is no customer-facing "cancel after payment"
  yet.
- No admin order routes (`specs/05-api-spec.md` §Admin `GET /admin/orders`,
  `POST /admin/orders/:id/refund`) — T019/T016.
- No order conversation link yet: `conversations.order_id` stays `null` until
  T013's orders are wired into messaging (T012 left the same gap).
- Reviews (T017) will read `COMPLETED` orders: the eligibility rule lives there.
- Duration is not validated against the service: an order books a whole slot, so
  a 90-minute slot with a 60-minute service books 90 minutes. Decide whether the
  order should reject mismatched slot lengths.

## T014 — Payment adapter

### Delivered

- Payment endpoints (`specs/05-api-spec.md` §Payments):
  `POST /orders/:id/payment-session` (201, provider parameters for the mini
  program), `GET /orders/:id/payment-status` (200), and the unauthenticated
  server-to-server route `POST /payments/wechat/notify` (200).
- New module `apps/api/src/modules/payments/` (domain / application /
  infrastructure / http) with two ports: `PAYMENT_GATEWAY` and
  `PAYMENT_REPOSITORY`.
- `PaymentGateway` is exactly the shape `specs/03-architecture-spec.md`
  §External provider ports prescribes — `createMiniProgramPayment`,
  `queryPayment`, `refund` — plus `MockPaymentGateway` (provider `MOCK`) for
  local/development/test, refused in production. The real WeChat flow is T015.
- `OrderService.markPaid(orderId)`: the single `PENDING_PAYMENT -> PAID`
  command, called by the payment context and idempotent by itself.
- Contract types added to `packages/api-contracts` (`payments.ts`:
  `PAYMENT_STATUSES`, `PAYMENT_PROVIDERS`, session/status/notification
  payloads) and three `ENDPOINTS` entries.

### Rules enforced

- **Idempotency** (acceptance criterion): a session request with an
  `Idempotency-Key` runs once — the second request replays the same payment —
  and the same key with a different order is `IDEMPOTENCY_CONFLICT` (409). A
  second call without a key reuses the *open* session instead of opening a
  second provider transaction. Both use the shared `IDEMPOTENCY_STORE` port
  (in-memory today, Redis in T022).
- **Callback replay safe** (acceptance criterion, E2E-04): a `SUCCEEDED`
  payment answers 200 with `applied: false` and touches nothing;
  `markSucceeded` is idempotent inside a transaction, and `OrderService.markPaid`
  returns an already paid order unchanged. One notification, one transition, one
  payment row.
- **Amount mismatch rejected** (acceptance criterion): the reported amount must
  equal `orders.amount_minor` exactly; anything else is
  `PAYMENT_CALLBACK_INVALID` (400), the order stays `PENDING_PAYMENT` and the
  attempt is not marked succeeded. Never trust client amount: no route, DTO or
  service path accepts a price — the amount always comes from the order.
- **Only the server marks an order paid**: the notification and the provider
  query are the two confirmation paths, both guarded by the same amount check.
  `GET /orders/:id/payment-status` asks the provider as well, so a lost
  notification still converges (and a provider that reports another amount is
  rejected instead of silently paying or silently failing).
- The 13 steps of `specs/08` §Create payment run in order: authenticated buyer,
  ownership, order state (`ORDER_NOT_PAYABLE` 409 when it is not
  `PENDING_PAYMENT`), server-calculated amount, idempotency key, gateway call,
  then the provider's parameters are returned. No secret is ever stored or
  returned (`payments` keeps only ids, references and amounts).
- A notification is validated before it can touch anything: unknown order,
  unknown provider transaction, malformed payload and unknown status are all
  rejected (400); a provider failure is recorded as `FAILED` and answered 402
  `PAYMENT_FAILED`, leaving the order unpaid.

### Tests

- Unit (16 new, 292 total in `apps/api`): policy (amount equality including
  fractional and off-by-one rejection, notification parsing and every malformed
  shape, open-vs-closed attempts) and service (session for the order's amount,
  unpaid state rejected, buyer-only, open session reused, keyed replay, callback
  pays once with `paidAt`/`rawCallbackRef` recorded, **replay answers
  `applied: false` with a single row**, mismatch rejected with the order and the
  payment untouched, unknown order/transaction rejected, provider failure
  recorded without payment, provider query confirms a lost notification, query
  with another amount rejected, status visible to the buyer only).
- Integration (16 new, 215 total): repository behaviour against PostgreSQL
  (`payments-repository.spec.ts`: create as `INITIATED`, the three lookups,
  attempts newest first, `markSucceeded` idempotent on replay, explicit status
  changes) and HTTP contract tests (`payments-http.spec.ts`: unauthenticated 401
  on session and status while the notify route answers without a token, session
  201 with reuse, keyed replay and `IDEMPOTENCY_CONFLICT`, non-payable order
  409, callback pays the order, **replay is a no-op (E2E-04)**, mismatch 400 with
  the order still unpaid, malformed/unknown callbacks 400, provider failure 402,
  provider-specific extra fields ignored, status query confirming a lost
  notification, query with a wrong amount rejected).
- Runtime smoke against the built app: unauthenticated 401 → session 201
  (20000, provider params, no secrets) → reuse → keyed replay → mismatch 400 with
  the order still `PENDING_PAYMENT` → success 200 → order `PAID`, payment
  `SUCCEEDED` with `paidAt` and `raw_callback_ref` → replay 200 `applied:false`
  → status `PAID` (data cleaned up afterwards).

### Database impact

None. T014 writes the T002 `payments` table (indexes `order_id` and
`status, created_at` already exist); no migration was added or modified.

### Deferred / known gaps

- **No signature verification**: `specs/08` requires verifying the WeChat
  notification signature and raising a security alert on failure. That belongs
  to the real adapter (T015); the mock has nothing to verify, so the route only
  validates the payload shape and the amount. Until T015 lands, the notify route
  must not be reachable from the public internet in production.
- **Provider is always `MOCK`**: adapter selection is not configurable yet. T015
  must add the WeChat gateway behind the same port and pick it from
  configuration (and the `wechat_payment_enabled` flag of
  `specs/03-architecture-spec.md` §Feature flags), refusing the mock in
  production.
- **Idempotency is in-memory**: as in T013, correct for one instance and tests,
  not for a multi-instance deployment (T022).
- `refund` exists on the port and in the mock but has no caller: refunds are
  T016.
- The notification payload shape (`orderNo`, `providerTransactionId`,
  `amountMinor`, `status`, `rawRef`) is a platform-defined contract, not the
  real WeChat envelope; T015 must adapt the real payload to it.
- `raw_callback_ref` is a reference only: nothing persists the raw notification
  yet, so an audit of a disputed callback is not possible before that store
  exists (T015/T022).
- No payment attempt limits ("payment attempt limits" in
  `specs/13-security-spec.md` §Abuse prevention) — T022.
- E2E-05 (price tamper) is covered at the payment and order level; a full
  journey waits for T023.

## T015 — WeChat payment integration

### Delivered

- `WeChatPaymentGateway`: the official API v3 adapter behind the same
  `PaymentGateway` port T014 introduced —
  `POST /v3/pay/transactions/jsapi` (prepay + `requestPayment` parameters),
  `GET /v3/pay/transactions/out-trade-no/{out_trade_no}` (query),
  `POST /v3/refund/domestic/refunds` (refund, no caller until T016).
  Docs: `specs/08-payment-and-settlement.md` and
  https://pay.wechatpay.cn/doc/v3/merchant/4012791911 ,
  https://pay.wechatpay.cn/doc/v3/merchant/4015459512 .
- `WeChatNotificationVerifier`: verifies the `Wechatpay-*` signature against the
  platform certificate the serial names, rejects stale timestamps, then decrypts
  the `AEAD_AES_256_GCM` resource with the APIv3 key. Steps 10–11 of
  `specs/08` §Create payment.
- `CachingWeChatCertificateProvider`: fetches `/v3/certificates`, decrypts each
  certificate and caches it by serial (10 minutes); never a hard-coded PEM.
- `resolveWeChatPayConfig` + `redactWeChatPayConfig`: every secret comes from
  the environment or a secret manager (private key inline **or** by path),
  production requires https URLs, partial configuration fails fast, and the
  redacted view is the only one that may ever be logged.
- Adapter selection (`PAYMENT_PROVIDER=wechat|mock`), mirroring T003's auth
  selection: production refuses the mock, and `wechat` without configuration
  refuses to start.
- `PassthroughNotificationVerifier`: the mock's notification format, so a
  gateway and its notification verification are always chosen as a pair; it
  refuses to run in production.
- The callback route now verifies the **raw** body (`rawBody: true` in the
  bootstrap, `@RawBody()` in the handler): a re-serialized object would
  invalidate the signature.
- `OrderService.findById` was added so the payment context can resolve the order
  through the payment's own `order_id` instead of trusting the notification's
  order number (the two are still compared, normalized).

### Rules enforced

- **Secrets externalized** (acceptance criterion): `WECHAT_PAY_APP_ID`,
  `_MCH_ID`, `_SERIAL_NO`, `_API_V3_KEY`, `_NOTIFY_URL`, `_PRIVATE_KEY` /
  `_PRIVATE_KEY_PATH` come from configuration only. Nothing is written to the
  database, nothing is returned by an API, and the redaction helper is the only
  supported way to put a config value in a log (`specs/13-security-spec.md`
  §Secrets, §Logging). Verified: starting with `PAYMENT_PROVIDER=wechat` and no
  secrets fails with `PAYMENT_PROVIDER=wechat requires WECHAT_PAY_*
  configuration`; a single set variable fails with "partially configured";
  `PAYMENT_PROVIDER=mock` in production fails; and the API log contains no key
  material.
- **The server confirms payment** (acceptance criterion): the notification is
  signature-verified and decrypted before an order can move, the amount in it
  must equal the order's, and `queryPayment` is the second confirmation path —
  `GET /orders/:id/payment-status` still asks the provider and converges on a
  lost notification. The client's "success" is never enough: no route accepts a
  payment result from the client.
- Order numbers travel as `out_trade_no` (`MO-20261001-ABCDEF01` ->
  `MO20261001ABCDEF01`, 6–32 alnum), the platform's own provider transaction id,
  so notifications, queries and the payment row all key on the same value.
- A notification is rejected when the signature is missing, unknown-signed,
  stale (> 5 min) or the resource cannot be decrypted — `PAYMENT_CALLBACK_INVALID`
  (400) every time, with the order untouched.

### Tests

- Unit (18 new, 314 total in `apps/api`): crypto (`out_trade_no` normalization,
  the v3 `Authorization` header verified against the real public key, JSAPI
  `paySign` verified, resource encrypt/decrypt round trip and a tampered
  ciphertext refused), configuration (absent / complete / partial / production
  https), gateway (prepay request body and signed header, CNY-only, query state
  mapping for SUCCESS/NOTPAY/USER_PAYING/CLOSED/PAYERROR, refund body, and
  "unavailable" errors that carry nothing), notification verification (happy
  path decrypt, tampered body, bad signature, unknown certificate, stale
  timestamp, missing headers, missing resource), and the passthrough verifier
  (mock payload parsed, production refused, bad payloads rejected).
- The T014 HTTP suite still passes unchanged: with the mock selected, the
  passthrough verifier accepts the platform payload, and the callback replay,
  amount-mismatch and provider-query cases behave exactly as before.
- Runtime smoke: with `PAYMENT_PROVIDER=wechat` the notification route rejects a
  headerless payload ("missing its signature headers") and an unsigned one
  ("signature has expired"), and the log contains no secret; with the default
  mock the whole T014 flow (session → notify → replay → `PAID`) still works
  (data cleaned up afterwards).

### Database impact

None. No migration was added or modified.

### Deferred / known gaps

- **Blocking product decision — the payer openid**: a WeChat JSAPI prepay needs
  `payer.openid`, and the platform does not keep one today (T003 stores only a
  keyed hash of it, `users.wechat_openid_hash`). The adapter therefore requires
  `CreatePaymentInput.payerOpenId` and throws a clear error without it, so
  `createMiniProgramPayment` cannot complete until one of these is decided:
  (a) persist the openid encrypted (field-level encryption is T022, and it is a
  privacy decision under `specs/10-privacy-and-minors.md`), or (b) resolve it at
  login and keep it in the session only. T016/T023 are unaffected because
  notifications and queries do not need it.
- **No live verification against WeChat**: the adapter is exercised with a
  generated RSA key pair and a stubbed `fetch`, the same way T003 tested its
  real `code2Session` adapter. A sandbox run with real merchant credentials is
  still required before production.
- **Merchant certificate rotation**: `CachingWeChatCertificateProvider` refetches
  only when a serial is unknown or the cache expired; there is no scheduled
  refresh endpoint (T024 operations).
- **`raw_callback_ref` is still empty**: the verified notification is not
  persisted anywhere, so a disputed callback cannot be audited yet (T022).
- **Refund has no caller** and no `out_refund_no` idempotency strategy: T016.
- The `wechat_payment_enabled` feature flag of `specs/03-architecture-spec.md` is
  still unused (the same open decision T007 raised for
  `teacher_provider_enabled` and T012 for `im_enabled`): adapter selection is by
  `PAYMENT_PROVIDER` configuration. Confirm with T019 whether the flag should
  also gate it.
- Notification payload mapping is the platform's own view of the decrypted
  resource; the raw WeChat envelope (id, event_type, create_time) is discarded.

## T016 — Refund

### Delivered

- Refund endpoints (`specs/05-api-spec.md` §Refund / §Admin):
  `POST /orders/:id/refund-request` (200, the customer asks),
  `GET /orders/:id/refunds` (200), and the audited command
  `POST /admin/orders/:id/refund` (200, admin/ops only).
- New module `apps/api/src/modules/refunds/` (domain / application /
  infrastructure / http) with the `REFUND_REPOSITORY` port.
- **Policy engine** (`domain/refund-policy.ts`): which order states and payment
  states may be refunded, the refundable amount (captured minus what already
  moved back), the amount ceiling, and which refund statuses actually moved
  money.
- Two order commands in the order context, where the state machine lives:
  `beginRefund` (`PAID|CONFIRMED|IN_PROGRESS -> REFUND_PENDING`, idempotent) and
  `completeRefund` (`REFUND_PENDING -> REFUNDED`).
- Contract types added to `packages/api-contracts` (`refunds.ts`:
  `REFUND_STATUSES`, `RefundResponse`, `RefundListResponse`,
  `RefundRequestResponse`) and three `ENDPOINTS` entries.
- `AUDIT_ACTIONS.refundInitiated` (`REFUND_INITIATED`) and an audit row per
  executed refund, as `specs/12-admin-spec.md` requires.
- `PaymentsModule` now also exports `PAYMENT_GATEWAY` and `PAYMENT_REPOSITORY`,
  so the refund context reuses the same adapter and reads the captured payment
  instead of duplicating either.

### Rules enforced

- **Cannot refund more than captured** (acceptance criterion): the ceiling is
  `payments.amount_minor` (what the provider captured) minus the sum of refunds
  that actually moved money (`SUCCEEDED` + `PROCESSING`). A failed or merely
  requested refund does not reduce it, so one failed attempt cannot silently
  shrink what the customer may get back. An amount above the ceiling, zero,
  negative or fractional is refused with `REFUND_NOT_ALLOWED` (409) before
  anything is written. Verified at runtime: a `20_001` refund against a `20_000`
  capture is rejected, and a second refund after a full one is rejected too.
- **Idempotent** (acceptance criterion): both commands accept an
  `Idempotency-Key`. A replay returns the same refund row and moves no extra
  money; the same key with a different amount (or a different order) is
  `IDEMPOTENCY_CONFLICT` (409). `beginRefund` and `completeRefund` are themselves
  idempotent, so a repeated request never fails on a second transition.
- **Only the audited command moves money**: the customer route puts the order in
  `REFUND_PENDING` and writes no refund row and makes no gateway call; the admin
  route (`specs/12`: "initiate refund when authorized") requires the admin/ops
  role, calls the gateway, records the outcome and the provider reference, and
  writes an audit row with actor, reason, before/after snapshot and request id.
- **Amount is server-side**: the admin route defaults to "everything still
  refundable"; a client amount is a request that is validated against the
  ceiling, never a number the platform trusts.
- State discipline: only a fully returned payment closes the order
  (`REFUND_PENDING -> REFUNDED`); a partial refund leaves it in the refund branch
  so the remainder can still be refunded, and a failed attempt leaves it there
  too rather than pretending nothing happened.
- Reading refunds is limited to the buyer and the provider of the order; a
  stranger, an unknown id and a malformed id all answer `NOT_FOUND`.

### Tests

- Unit (16 new, 330 total in `apps/api`): policy (refundable states including
  "already `REFUND_PENDING`" and unpaid-payment rejection, the ceiling with
  partial and over-refunded data, amount validation including the exact ceiling,
  full-vs-partial closure, which statuses move money, reason bounds) and service
  (request puts the order in the branch and moves no money, unpaid/finished
  orders refused, buyer-only, full refund by default with the gateway called
  correctly, **above-ceiling and second refund refused**, partial refund keeps
  the branch and a second one closes the order, a provider failure leaves the
  branch and a retry still works, `PROCESSING` keeps the branch, idempotent
  request and command plus a conflict, every refund audited with before/after,
  listing limited to the parties).
- Integration (12 new, 227 total): repository behaviour against PostgreSQL
  (`refunds-repository.spec.ts`: create as `REQUESTED`, read back, outcome and
  provider reference recorded, and the sum counting only `SUCCEEDED`/`PROCESSING`
  while a `FAILED` row is listed but not counted) and HTTP contract tests
  (`refunds-http.spec.ts`: unauthenticated 401 on all three routes, non-admin
  403 on the command, buyer request 200 with no money moved, stranger 404 and
  unpaid order 409, full refund closing the order with an audit row, over-amount
  and second refund 409, partial refund keeping the branch then closing,
  idempotent replay and `IDEMPOTENCY_CONFLICT`, listing for both parties and 404
  for a stranger, invalid payloads 400 including a client `amountMinor` on the
  customer route).
- Runtime smoke against the built app: order paid via the payment callback →
  buyer request 200 (`REFUND_PENDING`, 0 refund rows) → non-admin 403 →
  `amountMinor=20001` 409 → admin full refund 200 (`SUCCEEDED`, provider ref,
  order `REFUNDED`, audit `REFUND_INITIATED|ADMIN`) → second refund 409 → list
  200; then a second order: partial `5000` keeps `REFUND_PENDING`, replaying the
  key returns the same refund id with one row, the same key with `6000` is 409,
  and the remaining `15000` closes the order (data cleaned up afterwards).

### Database impact

None. T016 writes the T002 `refunds` table (indexes `order_id, created_at` and
`status, created_at` already exist); no migration was added or modified.

### Deferred / known gaps

- **No cancellation policy in any spec**: there is no time window ("full refund
  until 24 h before the session") to implement, so the policy engine covers the
  money invariants (state, payment, amount) only. `orders.policy_snapshot.
  cancellationPolicyId` stays `null`; define the rule (and where it is published,
  T019) if a window is wanted.
- **`specs/06` §Order draws only `PAID -> REFUND_PENDING -> REFUNDED`**, while the
  T013 transition table (reviewed as done) also allows a refund from `CONFIRMED`
  and `IN_PROGRESS`. T016 follows T013, because a paid but unfinished session is
  refundable in practice. Confirm whether the spec should be widened or the table
  narrowed.
- **A failed refund leaves the order in `REFUND_PENDING`**: there is no automatic
  way back to `PAID`/`CONFIRMED`, and no retry endpoint — an operator retries the
  admin command. Decide whether a failed refund should return the order to its
  previous state.
- **Partial refunds keep the order open in the refund branch**, so a session can
  be partly refunded and still deliverable. No spec covers this; T017 (review
  eligibility reads `COMPLETED`) is unaffected, but a product rule may be needed.
- **Idempotency is in-memory**: as in T013/T014, correct for one instance and
  tests, not for a multi-instance deployment (T022).
- The gateway refund is synchronous here: WeChat can answer `PROCESSING`, which we
  store but never poll, so a processing refund is only resolved by another
  command (T024 operations / a reconciliation job).
- `refunds` has no `out_refund_no` column, so the idempotency key the platform
  sends to WeChat is derived from the trade number; a real deployment should
  store it (schema change + spec update).
- No refund limits or fraud checks beyond the amount ceiling
  (`specs/13` §Abuse prevention); settlement adjustments are T021 and remain
  deferred ("V1 can delay provider settlement").
- `GET /admin/orders` (the admin order list of `specs/05`) is still missing: T019.

## T017 — Completion/review

### Delivered

- Review endpoints (`specs/05-api-spec.md` §Reviews):
  `POST /orders/:id/reviews` (201), `GET /orders/:id/reviews` (200) and the
  public `GET /providers/:id/reviews` (200).
- New module `apps/api/src/modules/reviews/` (domain / application /
  infrastructure / http) with the `REVIEW_REPOSITORY` port.
- **Eligibility policy** (`domain/review-policy.ts`): the order state that
  unlocks reviews, the rating scale, the text bound, who may review whom, and the
  rolling average.
- **Completion feeds the ranking signals** the platform already exposes but never
  wrote: the order command that reaches `COMPLETED` increments
  `provider_profiles.completed_order_count`, and a review of a provider rolls
  `rating_avg`/`rating_count` (both were reported as "still zero" by T010).
- Contract types in `packages/api-contracts` (`reviews.ts`: `REVIEW_STATUSES`,
  `REVIEW_DIRECTIONS`, the rating bounds, `ReviewResponse`, `ReviewListResponse`,
  `ProviderReviewListResponse`) and two `ENDPOINTS` entries.
- `FEATURE_FLAGS.providerReviewCustomer` (`provider_review_customer_enabled`):
  the policy switch of `specs/01` §Review, off by default like every unknown
  flag.

### Rules enforced

- **Review only after the order completed** (acceptance criterion): only
  `COMPLETED` unlocks reviews. `PAID`, `CONFIRMED`, `IN_PROGRESS` are refused
  because the session was not delivered, and `CANCELLED`, `REFUND_PENDING`,
  `REFUNDED`, `DISPUTED` are refused because the order ended in money or a
  dispute. Verified at runtime: `PAID` → 409, `IN_PROGRESS` → 409, after
  `complete` → 201.
- **One review per order and direction** (acceptance criterion): the check runs
  before the write, so the unique `(order_id, reviewer_user_id,
  reviewee_user_id)` is a backstop, not the only guard. The opposite direction is
  a different review, which is allowed.
- **The provider direction is policy-gated**: `specs/01` allows a provider to
  review a customer "only if enabled by policy", so the flag must be on — off by
  default, and a provider's attempt is refused with `REVIEW_NOT_ELIGIBLE` (409).
  Verified at runtime: 409 with the flag off, 201 once it is on.
- Only the two parties of the order can review it: a stranger, an unknown id and
  a malformed id all answer `NOT_FOUND` (404), the same as "not my order".
- The rating is a whole number `1..5` and the text is bounded (1 000
  characters); anything else is `VALIDATION_ERROR` (400).
- **Reviews never carry child data** (`specs/10`): the response has the order,
  the two parties, the rating and the text — never the child profile behind the
  order, and a hidden review returns `content: null`.
- The public page is read-only and gated by the same rule as discovery: only a
  discoverable provider has one (`findDiscoverable` → `null` is 404), and
  moderation-hidden content never appears while the row is kept.

### Tests

- Unit (15 new, 345 total in `apps/api`): policy (only `COMPLETED` is
  reviewable, the rating scale, the text bound, both directions and the policy
  switch, the rolling average, page bounds) and service (the customer direction
  with the rating rolled onto the provider, **every non-completed state
  refused**, one review per direction, the provider direction gated by the flag,
  a stranger refused, payload validation, the average over two reviews, listing
  for the parties only, and the public page hiding hidden content and refusing a
  non-discoverable provider). The order service spec now asserts that completing
  an order counts it exactly once.
- Integration (9 new, 236 total): repository behaviour against PostgreSQL
  (`reviews-repository.spec.ts`: create as `PUBLISHED`, the unique triplet as a
  lookup, the other direction not being a duplicate, and the public page
  excluding hidden content while keeping the row) and HTTP contract tests
  (`reviews-http.spec.ts`: unauthenticated 401, **review refused before
  completion with nothing written**, completed order 201 with
  `completed_order_count=1` and the rating rolled, duplicate 409, the provider
  direction refused and then allowed with the flag on, a stranger 404, invalid
  ratings and oversized text 400, listing for both parties and 404 for a
  stranger, and the public page: published only, hidden excluded,
  non-discoverable 404, unknown provider 404, `pageSize=51` 400).
- Runtime smoke against the built app: unauthenticated 401 → `PAID` order 409 →
  `IN_PROGRESS` 409 → `complete` 200 (`completed_order_count=1`) → customer
  review 201 (`rating_avg=5.00`, `rating_count=1`) → duplicate 409 → `rating=6`
  400 → stranger 404 → provider review 409 with the flag off → flag on → 201 →
  `GET /orders/:id/reviews` 2 items → `GET /providers/:id/reviews` 1 item (the
  customer direction only). Data cleaned up afterwards.

### Database impact

None. T017 writes the T002 `reviews` table (its unique triplet and index already
exist) and the two provider counters; no migration was added or modified.

### Deferred / known gaps

- **No auto-completion**: an order becomes `COMPLETED` only through the
  provider's command (T013). No spec defines auto-completion after the scheduled
  end, so a session nobody completes stays unreviewable; a scheduled job (T024)
  would need a spec decision.
- **Provider→customer gate is a new flag**: `provider_review_customer_enabled`
  is my choice of key, added to `FEATURE_FLAGS` and defaulting to off. If the
  product wants it on, enable it in `feature_flags` (T019 admin UI).
- **Review moderation (hide/unhide) has no endpoint yet**: the status and the
  repository behaviour exist and are tested, but the admin command belongs to
  T019/T020 and must be audited (`specs/12`).
- **Provider reviews are only rolled onto `provider_profiles`**: reviews of a
  customer have no column to aggregate into (the schema has none), so the
  customer direction is stored but not scored.
- **No dispute/review window**: nothing stops a review months later, and nothing
  links a review to a dispute (T018) — a disputed order is unreviewable today,
  which may be too strict if a dispute is resolved in the customer's favour.
- **Rating is never recalculated from scratch**: the average is rolled forward
  per review. If a review is ever deleted or merged, recompute from the rows.
- **Reviewer identity is public**: the public response carries
  `reviewerUserId` (a uuid), and no display name — resolving names is UI work
  (T019) and deliberately not done here to keep the payload an allowlist.
- **Settlement is still deferred** (`specs/08`: "V1 can delay provider
  settlement"), so completion only counts the session; it does not create
  settlement batch items (T021).
- No notification on completion (`REVIEW_REMINDER` exists in
  `notification_event_types` but nothing emits it; T023).

## T018 — Reports/moderation

### Delivered

- Report and moderation endpoints (`specs/05-api-spec.md` §Reports / §Admin):
  `POST /reports` (201), `GET /me/reports` (200), `POST /reports/:id/appeal`
  (200), `GET /admin/reports` (200), `POST /admin/reports/:id/resolve` (200),
  `POST /admin/moderation/:id/transition` (200),
  `POST /admin/moderation/:id/finalize` (200).
- New module `apps/api/src/modules/moderation/` (domain / application /
  infrastructure / http), which now **owns** `reports` and `moderation_cases`.
  The port that T012 created for the conversation report intake
  (`MODERATION_REPOSITORY`) was moved here and extended with the workflow; the
  messaging module imports it instead of keeping a second copy.
- **Moderation state machine** (`domain/moderation-policy.ts`): the transition
  table of `specs/06` §Moderation, the actions and the targets they may be taken
  on, the reason that every decision needs, and the independent-review rule of an
  appeal.
- Two real actions behind a decision: `HIDE_REVIEW` hides the review it was
  taken on (through the review repository, T017) and `DISPUTE_ORDER` moves the
  order to `DISPUTED` (through a new `OrderService.markDispute`, the order
  context still owning its own state).
- Contract types added to `packages/api-contracts` (`moderation.ts`:
  `REPORT_STATUSES`, `MODERATION_ACTIONS`, `ReportResponse`,
  `ReportListResponse`, `AdminReportQueueResponse`, `ModerationCaseResponse`,
  `ModerationDecisionResponse`) and seven `ENDPOINTS` entries.
- Four new audit actions: `MODERATION_RESOLVED`, `MODERATION_CASE_TRANSITIONED`,
  `MODERATION_APPEAL_FILED`, `MODERATION_APPEAL_FINALIZED`.

### Rules enforced

- **Admin action audited** (acceptance criterion): every command — resolve,
  investigate/action-required, finalize — writes an audit row with actor, action,
  before/after snapshot, IP hash and request id (`specs/12` §Admin principles
  and §Audit). The appeal filing is audited too, with the user as actor. Verified
  at runtime: one case carried the trail
  `MODERATION_CASE_TRANSITIONED → MODERATION_RESOLVED → MODERATION_APPEAL_FILED
  → MODERATION_APPEAL_FINALIZED`.
- **Appeal path supported** (acceptance criterion): the reporter — and the owner
  of the reported target, where one can be resolved (user, provider, service,
  order, review) — may appeal a resolved decision; the case moves
  `RESOLVED -> APPEALED`, and closing it (`APPEALED -> FINALIZED`) requires a
  different moderator than the one who decided it. Both rules are enforced in
  code and covered by tests; at runtime the deciding admin got 400 ("must be
  reviewed by somebody other than…") and a second admin got 200.
- **State is a command, never a PATCH**: a case only moves along the transition
  table, `FINALIZED` is terminal, and the decided states (`RESOLVED`, `APPEALED`,
  `FINALIZED`) are reachable only through the decision commands, which is what
  writes the reason.
- **No silent data edits**: a decision without a written reason is refused, and a
  report already closed cannot be decided again.
- **An action belongs to its target**: `HIDE_REVIEW` is refused on anything but a
  review and `DISPUTE_ORDER` on anything but an order, so a decision can never
  touch a target it was not taken on.
- One active case per target (from T012): a second report on the same target is
  still recorded as intake, and joins the case that is already open; after a
  decision the target is free again.
- The queue is admin/ops only; a non-admin gets `FORBIDDEN` (403) and an
  anonymous caller `AUTH_REQUIRED` (401). A reporter sees only their own reports,
  never the case notes.

### Tests

- Unit (20 new, 364 total in `apps/api`): policy (which statuses are active, the
  full transition table including what is illegal, which action fits which
  target, the reason requirement, the description bound, independent review, uuid
  targets, page bounds) and service (intake creating exactly one active case per
  target, a non-uuid target refused, own listing and the queue with a status
  filter, **a resolution audited with actor/reason/before/after**, dismissing,
  refusing a second decision, refusing an action on the wrong target, **hiding
  the review**, **disputing the order**, the transition command refusing decided
  states and reopening, the whole appeal path including the independent reviewer
  and terminal `FINALIZED`, the target owner's right to appeal and only while
  resolved, and an order that the order context refuses to dispute).
- Integration (12 new, 248 total): repository behaviour against PostgreSQL
  (`moderation-repository.spec.ts`: report and case written together, at most one
  active case per target with the second intake still recorded, outcome on both
  rows, and a resolved target opening a fresh case) and HTTP contract tests
  (`moderation-http.spec.ts`: unauthenticated 401 and non-admin 403, intake 201
  plus the author's listing, five invalid payloads 400, resolve audited in the
  database and refused twice, `HIDE_REVIEW` flipping the review to `HIDDEN`,
  `DISPUTE_ORDER` flipping the order to `DISPUTED`, an action on the wrong target
  refused, the appeal path end to end with the audit trail checked row by row,
  the transition command audited, and the queue visible to an admin only).
- Runtime smoke against the built app: unauthenticated 401 → report 201 →
  invalid target type 400 → own listing → non-admin queue 403 → admin queue →
  transition 200 (`INVESTIGATING`) → resolve 200 with two audit rows → second
  resolve 400 → stranger appeal 403 → reporter appeal 200 (`APPEALED`) →
  finalize by the deciding admin 400 → finalize by another admin 200
  (`FINALIZED`) → the four-action audit trail (data cleaned up afterwards).

### Database impact

None. T018 writes the T002 `reports` and `moderation_cases` tables (their
indexes already exist); no migration was added or modified.

### Deferred / known gaps

- **Moderation visibility for the reporter is minimal**: `GET /me/reports` shows
  status and case status, never the decision notes (`AGENTS.md` §9). A
  notification that a decision was taken (`MODERATION_RESULT` exists in
  `notification_event_types`) is T023.
- **Two enum values are reachable only through the transition command**: `OPEN`,
  `INVESTIGATING` and `ACTION_REQUIRED` cover investigation; nothing sends the
  "action required" notice to the user yet (T019/T023).
- **No severity workflow**: `severity` is written when a moderator passes it, but
  nothing ranks the queue by it. `specs/12` §Provider review wants "risk flags
  first" for the provider queue; the moderation queue here is simply newest
  first.
- **Case assignment is implicit**: the first moderator who touches a case becomes
  `assigned_moderator_id`. There is no explicit claim/assign route, and no
  unassignment.
- **Actions are limited to two**: hiding a review and disputing an order are the
  only ones with an effect. Suspending a provider, cancelling an order or
  refunding as a moderation outcome are separate audited commands that belong to
  T019 (and to the refund/dispute flows of T016/T018) and are recorded today only
  as text in `action_taken`.
- **Appeal right for messages and conversations is the reporter only**: those
  targets have no single owner on our side (the transport owns the message), so
  the counterparty cannot appeal them.
- **A report on a user has no effect by itself**: `NO_ACTION` is the default, and
  suspending or restricting an account stays an admin command of T019.
- **Rate limiting is T022**: anybody may file a report, and nothing throttles a
  flood of intakes (`specs/13`).
- **Fixed as part of this task**: `payments-repository.spec.ts` ordered attempts
  by `created_at` alone; that column has millisecond precision, so two attempts
  created in the same millisecond had no stable "newest" and the assertion failed
  under full-suite load. The repository now breaks the tie by `id` and the test
  separates the two attempts in time.

## T019 — Admin

### 交付（后端运营接口）

| 区域 | 文件 |
|---|---|
| 引导与平台概览 | `src/modules/admin/http/{admin-bootstrap,admin}.controller.ts`（11 个文件） |
| 平台配置 | `src/modules/platform/http/admin-platform.controller.ts`（12 个文件：bootstrap、特性开关、平台规则、用户、订单、审计日志） |
| 各域运营接口 | `admin-taxonomy`、`admin-verification`、`admin-compliance`、`admin-provider`、`admin-moderation`、`admin-refund` 控制器 |
| 控制台登录（T027b 增补） | `src/modules/auth/http/console-auth.controller.ts` |

### 验收口径

- 「MVP 无需直接改库即可运行」：管理员由 `POST /admin/bootstrap` 引导产生并写入审计，不需要手工改库；后续登录走 `POST /auth/console/login`，登录本身不授予角色（角色只能由已持有 ADMIN/OPS 的账号签发）。
- 运营动作（审核、合规、退款、下架、开关）全部经接口并留审计。

### 已知缺口

- `specs/11` §Admin Web 的运营页面未实现：`apps/admin/app/page.tsx` 仍是 T001 占位页，API client 只有健康检查。为此仓库审计将其记为一等阻塞项 B1，后续管理台任务（FE 侧）承接。

### 测试

- `apps/api/test/integration/admin-operations-http.spec.ts`、`admin-platform-http.spec.ts`（既有记录，本轮未重跑）；控制台登录见 T027b 的新增测试。

## T020 — Analytics

### Delivered

- **Event abstraction**: new module `apps/api/src/modules/analytics/` with a
  domain port (`ANALYTICS_SINK`), an event model, a policy and a service. The
  platform writes no analytics table in V1: the adapter emits one structured log
  line per event, which is what `specs/03-architecture-spec.md` §Observability
  asks for and what an external pipeline turns into the metrics of `specs/15`.
- **Core funnel events** wired into the real flows (`specs/15` §Funnel):
  - parent: `provider_list_viewed`, `provider_detail_viewed`, `order_created`,
    `payment_started`, `payment_succeeded`, `order_completed`,
    `review_submitted`, `chat_started`;
  - provider: `application_started`, `application_submitted`, `provider_approved`,
    `service_published`, `order_received`, `inquiry_received`,
    `verification_submitted`.
- Contract vocabulary in `packages/api-contracts` (`analytics.ts`: the two
  funnels, every event name, and the event as it leaves the platform).
- Emitters are wired with **optional** injection: analytics is a side effect and
  never a dependency, so a context can run — and be unit-tested — without a
  pipeline. Every emitting module imports `AnalyticsModule` so production and
  integration tests do have one.

### Rules enforced

- **No child PII in analytics** (acceptance criterion). The policy refuses a
  dimension before an event can leave the process if it is, or could carry, the
  identity of a person — and above all of a child: `child_id`, `child_name`,
  `student_id`, `guardian_id`, `minor_id`, anything containing `name`, `birth`,
  `school`, `grade`, `phone`, `email`, `address`, `wechat`, `openid`, `unionid`,
  `identity`, `idcard`, `document`, `certificate`, `avatar`, `photo`, or free
  text (`content`, `message`, `note`, `reason`, `description`). Keys are
  normalised first (`childId` is judged as `child_id`), so spelling cannot slip
  past the rule.
- What is left is a metric: `amount_minor`, `price_minor`, `result_count`,
  `service_count`, `rating`, `has_child`. `has_child` says a booking involved a
  child without saying which child.
- **Actors are counted, not named**: the acting account is a keyed HMAC hash
  (the same treatment an IP gets in the audit log), never the raw user id.
- Dimensions are flat, primitive and bounded (≤ 20 keys, ≤ 200 characters per
  value, keys matched against a strict pattern).
- Only the events of `specs/15` exist: anything else is refused, so a funnel
  cannot silently grow a shadow metric.
- **Analytics never breaks the platform**: a failed sink is swallowed; only a
  malformed event (a programming error) fails loudly, and it is caught by tests.

### Tests

- Unit (10 new, 391 total in `apps/api`): policy (every child dimension refused,
  contact details, documents and free text refused, the metrics that are allowed,
  flat/primitive/bounded dimensions, known events and their funnel, stable actor
  hashing) and service (an event with a hashed actor and the objects involved, a
  child dimension refused before anything is sent, an unknown event refused, and
  a broken pipeline returning `null` instead of failing the request).
- Integration (1 new, 260 total): `analytics-http.spec.ts` replaces the sink with
  a spy and drives a real booking end to end — discovery, order, payment — then
  asserts the funnel events fired in order, that no event carries a raw account
  id, that no prop key is a personal dimension, and that `order_created` carries
  exactly `amount_minor` and `has_child`.
- Runtime smoke against the built app: the whole platform lifecycle produced the
  structured lines `application_started → application_submitted →
  provider_approved → service_published → provider_list_viewed →
  provider_detail_viewed → order_created → order_received → payment_started →
  payment_succeeded → order_completed → review_submitted → chat_started →
  inquiry_received`, each with a hashed actor (or none), opaque object ids and
  nothing else (data cleaned up afterwards).

### Database impact

None: no analytics table exists in `specs/04-database-spec.md`, and none was
added. Events go to the log.

### Deferred / known gaps

- **Four funnel events have no emitter**: `home_viewed`, `search_started`,
  `booking_started` (the client knows the page, the server does not) and
  `order_received` is emitted, but `verification_submitted` could not be
  exercised in the smoke because the seeded verification rows bypass the API.
  A client-side ingest endpoint would be needed for the first three — and it
  needs rate limiting first (T022), so it was not invented here.
- **No metrics API**: the core metrics of `specs/15` (search→detail CTR,
  chat→order conversion, median verification time, repeat purchase rate…) need
  event data joined over time. With a log sink they belong to the pipeline
  outside the service; the admin dashboard (T019) exposes only what the database
  can answer (GMV, refund total, conversion from order states).
- **No persistence, so no backfill**: if a warehouse sink is added later, history
  starts at deployment.
- **The sink is in-memory logging**: swapping in a warehouse client touches the
  analytics module only, but nothing batches or retries today.
- **`provider_list_viewed` is emitted per request, not per user session**: there
  is no visitor id, so "search → detail CTR" from these events is per request.
  A session/visitor key (hashed, non-identifying) would be needed — and is a
  privacy decision, not a technical one.
- **Props are not versioned**: adding or renaming a dimension changes the event
  shape silently for the pipeline.

## T021 — Career domain

### Delivered

- **One career gate, applied everywhere.** `ProviderApplicationService.
  assertMarketplaceOpen()` is the single entry check (flagged marketplace →
  `FORBIDDEN`), and it is now called from the application, the submission, the
  publication gate and the availability and service routes — previously only the
  application itself was checked.
- **The discovery gate moved into the read model.** `PrismaProviderDirectory`
  now reads the flag: a career listing is empty and a career provider is not
  discoverable while the marketplace is off. Because ordering (T013) and public
  reviews (T017) both go through `findDiscoverable`, they inherit the gate —
  this closes a real leak: **knowing a career `serviceId` used to be enough to
  place an order after the flag was switched off**.
- **A closed marketplace is never searchable**: `refreshSearchable` treats the
  flag as one of the gates, so a mentor approved while it was on disappears when
  it is switched off and reappears when it is switched back on.
- **Career services publish expertise**: `assertTagging` is now per marketplace
  — a tutoring service names at least one `SUBJECT`, a career service names at
  least one `SKILL` (`specs/00-product-spec.md` §Career Mentor: "Publish
  expertise"). Previously a career service could be published with no tag at
  all.
- No new table, no new route and no duplicated provider/order/payment/review
  code: the career journey reuses every existing context unchanged.

### Rules enforced

- **Flag off hides all career routes** (acceptance criterion): applying is
  `FORBIDDEN` (403); submitting, publishing, creating a career service and
  offering career availability are `FORBIDDEN`; the listing is empty; the
  profile page, the public reviews and an order created from a known service id
  are all `NOT_FOUND` (404) — the same answer as "does not exist", so nothing
  about why it is hidden leaks.
- **Flag on reuses the infrastructure** (acceptance criterion): a career mentor
  applies with `CAREER_MENTOR`, verifies, is approved by an admin, publishes a
  service tagged with a skill, offers availability, and is then booked, paid,
  completed and reviewed through the ordinary order, payment and review paths.
  `orders.domain` is `CAREER` (derived from the provider, never from a client).
- The flag is read from the database on every call, so switching it off takes
  effect immediately, with no restart and no leftover state.
- Capabilities stay bound to their marketplace: `CAREER` accepts only
  `CAREER_MENTOR`, and tutoring cannot declare it (existing rule, unchanged).

### Tests

- Unit (2 new, 393 total in `apps/api`): every career entry point closes while
  the flag is off (submitting and publishing refused, the tutoring marketplace
  untouched), and a career provider never stays searchable while the marketplace
  is off (it becomes visible again when the flag returns). The service policy
  test now covers the per-marketplace tagging rule; the career service test
  asserts a skill tag is required.
- Integration (4 new, 264 total): `career-http.spec.ts` — with the flag off
  there is no career application and no career listing; a mentor created while
  it was on becomes invisible afterwards, cannot be ordered **by service id** and
  has no public reviews; the mentor's own routes (submit, service, availability)
  are closed; and with the flag on the whole journey runs on the existing
  infrastructure (discovery, order with `domain=CAREER`, payment, completion,
  review, public reviews) with the admin flag change audited
  (`FEATURE_FLAG_CHANGED`).
- Runtime smoke against the built app: flag off → career application 403, career
  list empty; flag on through the admin route → application 201, submit,
  approve, **career service without a skill 400**, with a skill 201, publish,
  career list 1 / tutoring list 0, order 201 with `domain=CAREER`, payment,
  confirm/start/complete, review 5, mentor reviews 1, order `COMPLETED`.
  Flag off again → profile 404, list 0, reviews 404, order by id 404; two
  `FEATURE_FLAG_CHANGED` audit rows (data cleaned up afterwards).

### Database impact

None. The career marketplace uses the existing `provider_profiles`,
`provider_capabilities`, `services`, `service_terms`, `availability_slots`,
`orders`, `payments`, `reviews` and `feature_flags` tables; no migration was
added or modified.

### Deferred / known gaps

- **No career-specific verification.** `REQUIRED_VERIFICATION_TYPES` is still a
  constant (`IDENTITY`, `EDUCATION`), so a career mentor verifies exactly like a
  tutor. `specs/00` asks them to "verify professional profile" and the schema
  has an `EMPLOYMENT_PROOF` *document* type, but there is no `PROFESSIONAL`
  *verification* type and no spec that defines one — adding it needs a schema
  change and a spec decision first.
- **No career taxonomy beyond `SKILL`.** `specs/02` mentions a career bounded
  context (career goals, mentor capabilities) that has no table; industry,
  role and seniority terms do not exist. Career services are tagged with the
  generic `SKILL` list, which is shared with tutoring.
- **`has_child` is still emitted for career orders**: analytics (T020) reports
  whether a booking involved a child, and nothing stops a career order from
  carrying a child profile. A career order should probably reject one.
- **Career orders can carry a `childId`** — `OrderService` does not distinguish
  domains here; a student buying mentoring has no child.
- **No career-specific notification or UI**: the mini-program pages of
  `specs/11` (mentor discovery, mentor detail) are not built here; the API hides
  the routes, which is what the acceptance criterion asks.
- **`providerType` defaults to `TUTORING`** on the provider routes: a career
  mentor who forgets `?providerType=CAREER` acts on their tutoring application
  (or gets "no application"). The client must always pass it.
- **Switching the flag off does not cancel existing career orders**: they run to
  completion; only new ones are refused.

## T022 — Security hardening

### Delivered

- **Rate limiting** (`specs/13` §API, §Abuse prevention): a `RATE_LIMITER` port
  with named policies in one place, an in-memory fixed-window implementation and
  a global interceptor that applies them. Policies: login and public search per
  address; provider applications, payment sessions, reviews, reports and
  conversations per account. Every route falls back to a per-address default, so
  no route is ever unlimited. Refused calls answer `429` with
  `RATE_LIMITED`, a `Retry-After` and `RateLimit-Limit/Remaining` headers.
  The limiter runs as an interceptor (after authentication) so an account policy
  counts the signed-in account, and the key is the account id — never the raw
  address (`AGENTS.md` §9).
- **Secure headers** (`specs/13` §API): one middleware sets `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'none' …`, `Cross-Origin-Resource-Policy`,
  `Cross-Origin-Opener-Policy`, `X-Permitted-Cross-Domain-Policies`,
  `Strict-Transport-Security` and `Cache-Control: no-store` — nothing may sniff,
  frame, embed or cache an answer that can carry personal data.
- **CORS allowlist** (`specs/13` §API): `CORS_ALLOWED_ORIGINS`. With nothing
  configured no browser origin may read a response, and `*` is refused as not
  being an allowlist; production stays closed rather than falling back to open.
- **Input size limits** (`specs/13` §API): a platform-level body limit (64 KiB)
  enforced on `content-length`, plus a mapping of the body-parser's
  `entity.too.large` onto the API error envelope, so an oversized request answers
  `413` in our own shape instead of an opaque server error.
- **Private object access** (`specs/13` §File upload): verified and pinned by
  tests — a document response carries only an id and a type, never the generated
  object key, the file hash or a URL; two upload requests for the same case
  produce different keys; only whitelisted content types and sizes are accepted;
  an admin opening a document gets a short-lived signed URL and an audit row.
- **Field-level responses** (`specs/13` §Authorization): pinned by tests that
  scan the payloads of `/me`, the public listing and the provider profile for
  phone, WeChat identifier, unionid, id number, password hash and every token
  field; admin routes stay behind the role (`403` for a customer, `401`
  anonymous).

### Rules enforced

- Rate limits are counted, refused and reported with a retry hint; a caller
  cannot extend a window by spacing requests out, and each caller is counted
  separately.
- Nothing that may carry personal data is cacheable, frameable or embeddable.
- Cross-origin access is opt-in by named origin only.
- A request bigger than the platform accepts never reaches a handler.
- Private objects stay private: the key is server-generated, unguessable and
  never returned; access is a signed, short-lived, audited URL.
- Responses stay allowlists: no phone, identifier, credential or token field is
  ever serialised.

### Tests

- Unit (8 new, 401 total in `apps/api`): the limiter allows up to the limit and
  then refuses with a positive `Retry-After`, counts callers separately, opens a
  fresh window after the old one expires, keeps the policies in one place with a
  default, and the CORS resolver is closed by default, accepts named origins,
  refuses `*` and stays closed in production.
- Integration (7 new, 271 total): `security-http.spec.ts` — the secure headers
  are present; a route is limited and answers `429 RATE_LIMITED` with
  `Retry-After`; an account-scoped policy is keyed on the account id and an open
  one on the address hash; an oversized body is `413`; a document upload refuses
  a non-whitelisted type and an oversized file, returns different URLs for two
  requests and lists documents without key, hash or URL; personal fields are
  absent from `/me`, the profile and the public listing; admin routes refuse a
  customer and an anonymous caller.
- Runtime smoke against the built app: every secure header present, no
  `x-powered-by`, `RateLimit-Limit/Remaining` on a normal call, eleven logins
  from one address → ten `201` then `429 RATE_LIMITED`, a 300 KiB and a 70 KiB
  body both `413` in the API envelope while a normal request still succeeds, no
  `Access-Control-Allow-Origin` for an unknown origin, `/me` carrying only id,
  name, avatar, status and roles, and two upload URLs for the same case
  differing (data cleaned up afterwards).

### Database impact

None. No migration was added or modified.

### Deferred / known gaps

- **The rate limiter is per instance.** Counters live in memory; a multi-instance
  deployment needs a shared store (Redis) behind the same port. Nothing else has
  to change, but until then the limits are per replica.
- **No distributed abuse signals**: no IP/device reputation, no captcha, no
  escalating ban (`specs/13` lists these as an optional future module).
- **CSRF for the admin web app is not implemented** (`specs/13` §API): there is
  no admin web session yet — the admin app has no login — so there is nothing to
  protect. It becomes a real requirement with the admin UI (T023/T019 follow-up),
  and the recommendation is same-site cookies plus a token, not a bearer token in
  local storage.
- **No output size limits** beyond paging: every listing is bounded, but a
  single large object (e.g. a long list of capabilities) is not measured.
- **Malware scanning is unavailable** (`specs/13`: "where available"): the mock
  object store does none, and no hook exists for a real one.
- **`Retry-After` and `RateLimit-*` are the plain form**, not the draft IETF
  `RateLimit-Policy` syntax.
- **Security headers are not configurable per deployment** (CSP report URI,
  HSTS preload): they are fixed, which is deliberate but may need to move to
  configuration for the admin web app.
- **Document access is admin-only**: a provider cannot download their own
  uploaded document through the API; if that is wanted, it needs the same signed,
  audited path.

## T023 — E2E

### Delivered

- **The eight journeys of `specs/14-test-strategy.md` §E2E**, each as its own
  spec in `apps/api/test/e2e/`:

  | Flow | Journey | What it pins down |
  |---|---|---|
  | E2E-01 | parent tutoring | login → child → search → detail → order → payment → confirm/start/complete → review, and the two ranking signals (`completed_order_count`, `rating_count`) the delivery produced |
  | E2E-02 | provider onboarding | application → submit → identity + education verification → admin approval → service publish → discoverable (and *not* discoverable before a service exists) |
  | E2E-03 | teacher restriction | a teacher capability in `PENDING` compliance cannot be ordered and no order row is written; after the admin approval the same order succeeds |
  | E2E-04 | payment replay | the same gateway callback twice moves the order once: one `SUCCEEDED` payment, `applied: false` on the retry, order stays `PAID` |
  | E2E-05 | price tamper | an `amountMinor`/`priceMinor` in the booking payload is refused (400); the order and the payment session carry the server's price; a callback for another amount never moves the order |
  | E2E-06 | child isolation | another parent, the provider and an anonymous caller are all denied the child, and no field of the child appears in any of those answers |
  | E2E-07 | admin audit | a suspension is recorded with actor, reason and request id, is readable through the operations pages, and restoring is recorded too |
  | E2E-08 | refund | a paid order → customer request (no money moves) → admin refund → order `REFUNDED`, the payment stays `SUCCEEDED`, refunding again is refused, and the refund is audited |

- **`test/e2e/helpers/e2e.ts`**: the harness. It boots the **whole `AppModule`**
  — the real module graph, guards, interceptors, global validation pipe, error
  filter, rate limiter and global prefix — against the disposable database. Only
  the database is swapped, so a journey cannot pass because a test wired a
  service differently from production. Journeys are written as HTTP calls
  through the real routes, and a flow never creates state behind the platform's
  back: even the first administrator comes from `POST /admin/bootstrap`.
- **Wiring**: `vitest.integration.config.ts` now also collects `test/e2e`,
  `vitest.config.ts` excludes it from the unit run, and `apps/api` gained
  `test:e2e` (the integration script is now scoped to `test/integration`). Root
  `pnpm test:e2e` and `pnpm verify` include it.
- **CI**: a new step "End-to-end critical flows (specs/14)" runs `pnpm test:e2e`
  after the database integration tests.

### Rules enforced

- Every journey runs through the public API: no seeding of domain state, no
  direct repository writes except to create the taxonomy a journey names (the
  disposable database is rebuilt without seed data) and to assert on what the
  platform stored.
- An E2E test asserts the whole state of a flow, not one call: the order status,
  the money rows, the ranking counters and the audit row are all checked after
  the journey, so a flow that "returns 200" cannot pass on its own.
- The suite leaves the database as it found it (`resetPlatform`), so the
  integration suite that runs before it is unaffected.

### Tests

- 8 new E2E tests (one per journey), all passing: `pnpm test:e2e` →
  **8 passed**.
- Regression: unit **401 passed**, integration **271 passed / 41 files**,
  format ✅, lint ✅, typecheck ✅, build ✅, `prisma migrate deploy` ✅,
  `prisma db seed` ✅ (users=7 roles=14 featureFlags=6 taxonomyTerms=28).
- `pnpm verify` (lint + build + typecheck + unit + integration + e2e) is the
  local equivalent of the CI pipeline.

### Database impact

None: no migration was added or modified; the E2E suite runs against the
disposable database the integration config already rebuilds from the committed
migrations.

### Deferred / known gaps

- **Only the eight flows of the spec exist.** `specs/06` appeal paths, the career
  marketplace journey and the moderation lifecycle are covered by integration
  tests, not by an E2E journey; if they are critical flows, `specs/14` should
  list them.
- **No E2E coverage of the admin web or mini-program UI**: there is no UI yet, so
  "E2E" here means API journeys through the real application.
- **The rate limiter is live in these tests**: journeys log in a handful of times
  per file and would fail past the login limit; that is intentional (it proves
  the limit), but a longer journey will need to account for it.
- **No child-with-order journey**: E2E-01 books for a child, but nothing asserts
  what a provider may see about that child through an eligible order —
  `specs/10` leaves that to T024/production review.
- **Notifications are not asserted**: `REVIEW_REMINDER`, `MODERATION_RESULT` and
  friends are still never sent (T024).
- **The suite shares one database with the integration suite**, so E2E files run
  sequentially; running them in parallel needs per-file schemas.

## T024 — Production readiness

### Delivered

**Backups** (`ops/backup.sh`, `ops/backups.md`)

- Logical dump with `pg_dump --format=custom` (compressed, selectively restorable),
  `--no-owner --no-privileges`, one file per run plus a `.sha256` that the script
  verifies before it publishes the dump; an empty dump is refused.
- The password never reaches the process list: it travels in `PGPASSWORD` and
  `pg_dump` is called with host/port/user/database only. The connection string is
  never echoed, not even on failure.
- Retention pruning by `RETENTION_DAYS` (default 30), documented against
  `specs/10-privacy-and-minors.md`: personal data must stop existing.
- Policy for the rest: WAL/point-in-time, object storage for verification
  documents, and Redis explicitly **not** backed up (cache, idempotency keys and
  short-lived locks are reconstructible; restoring stale idempotency keys would
  be worse than losing them).

**Restore test** (`ops/restore.sh`, `apps/api/test/integration/backup-restore.spec.ts`)

- `ops/restore.sh` verifies the checksum, creates the target database, restores
  with `--clean --if-exists --exit-on-error`, then counts what came back and fails
  if `users`, `orders`, `payments`, `refunds`, `reviews` or `taxonomy_terms` are
  missing — it never trusts `pg_restore`'s exit status alone.
- The automated drill runs the **real** scripts end to end: write rows → dump →
  checksum → restore into a scratch database → compare every table's row count
  with the source → read a value back → drop the scratch database. It is part of
  `pnpm test:integration`, so **every CI run performs a restore drill**.
- It skips loudly when `pg_dump`/`pg_restore`/`psql` are missing or the client is
  older than the server — an environment fact, not a pass — and CI now installs a
  PostgreSQL 16 client before the suite so the drill actually runs.

**Monitoring** (`ops/monitoring.md`, readiness probe, access log)

- `GET /api/v1/health/ready`: the probe asks the database (`SELECT 1`) and returns
  200 `database: "up"` or **503** when it cannot. It exposes one bit — up or down
  — and nothing about where the database is: no host, no version, no connection
  string, no row counts. Liveness stays at `GET /api/v1/health`.
- A new `health.probe` rate-limit policy: a probe throttled by the service it is
  watching is a false alarm.
- `AccessLogMiddleware` writes one structured JSON line per request: request id,
  method, path, status, duration and a **hash** of the caller address. The query
  string is dropped (private-object URLs carry signatures, search URLs carry PII),
  and no header, cookie or body field is ever written — `specs/13` §Logging. Probe
  traffic is not logged.

**Alerts** (`ops/alert-rules.yml`)

- Prometheus-format rules for availability, money (payment callbacks, refunds,
  orders stuck in `REFUND_PENDING`), database, **backups** (age of the newest
  dump, because a scheduler that stopped produces no failure), trust and safety
  (moderation and verification backlogs, aged cases) and abuse (429 spikes, login
  failures). Each rule points at the runbook section that handles it.

**Runbook** (`ops/runbook.md`)

- Procedures with "see / do / fixed when": API down, database unreachable, payment
  callbacks failing, refund stuck, backup missing, restore drill skipped, restore,
  slow database, connections exhausted, moderation and verification backlogs,
  rate-limit spikes, credential stuffing, secret rotation, deploy and rollback.
- The recurring rule: never fix money or state with SQL — every privileged action
  goes through the audited platform route.

**Incident response** (`ops/incident-response.md`)

- S1/S2/S3 with response times and comms cadence, named roles (commander,
  operations lead, scribe, communications — the person debugging is never the
  commander), the first fifteen minutes, containment table, evidence preservation,
  a blameless postmortem template, and quarterly drills.

**Release checklist** (`ops/release-checklist.md`)

- The CI gate (which now includes the restore drill, the integration suite and the
  eight E2E journeys), then the human gates: migrations, security and privacy,
  money, product rules, observability, rollout and sign-off.

- `ops/README.md` indexes all of it and states RPO ≤ 15 min, RTO ≤ 60 min.
- `README.md` gained an "Operations" section linking the documents and scripts.

### Tests

- Unit (+4): readiness up/down and that the payload leaks no connection detail;
  access log writes one line without query string, token or raw IP; probes are
  silent. `apps/api` unit **405 passed**.
- Integration (+3): the restore drill (dump → checksum → restore → every table's
  row count → drop), and the probes over HTTP: `/health` 200, `/health/ready` 200
  with a real database and **503** with a dead one, with no connection detail in
  either body. **274 passed / 43 files**.
- E2E: **8 passed** (unchanged).
- format ✅, lint ✅, typecheck ✅, build ✅, `prisma migrate deploy` ✅,
  `prisma db seed` ✅.
- Runtime smoke on the built app: `/health` 200, `/health/ready` 200
  `database: "up"` in 3 ms, one access-log line for a real request with a hashed
  address and no query string, and no access line for the probes.

### Database impact

None: no migration, no schema change. The drill creates and drops a scratch
database, and the scratch database I used while writing the scripts was dropped.

### Deferred / known gaps

- **No metrics endpoint**: there is no Prometheus exporter, so the alert
  expressions in `ops/alert-rules.yml` assume a collector that can read the
  structured access log (request rate, status class, latency) and PostgreSQL
  statistics. Adding `/metrics` would need a decision about exposing it (and
  preferably a dependency), so it is left to the deployment project.
- **No alert delivery configuration**: rules, not Alertmanager routes or
  on-call schedules — those are organisation-specific.
- **Dashboards are described, not shipped**: there is no Grafana JSON in the repo.
- **The drill is skipped silently enough to be forgotten** if a runner loses its
  PostgreSQL client: CI installs the client, but if the install ever fails the
  drill warns and skips; the `RestoreDrillSkipped` alert is the backstop.
- **Encryption at rest for off-host dumps is a procedure, not code**: `backups.md`
  says to encrypt before leaving the host; there is no script for it.
- **No scheduled job in the repo**: the cron line is documentation only — the
  scheduler lives in the deployment project.
- **Redis, object storage and secret rotation** are documented but not automated.
- **No synthetic monitoring from outside**: the probes are checked from inside the
  network; an external check still has to be added.

## T025 — Git 与工程基线修复

### 交付

- `implementation/launch/repository-audit.md`：仓库结构与可启动性审计（工作区、后端/管理台/小程序、数据库、测试、T001–T024 矩阵、阻塞项）。
- `implementation/launch/git-baseline-audit.md`：Git 基线审计（status/log/branch、未跟踪与已修改文件、`.gitignore`、敏感文件与密钥扫描、T001–T024 入库核对、分组提交方案）。
- `implementation/launch/environment.md`：本地启动手册（前置条件、环境变量、后端/管理台/小程序启动步骤、已知构建坑、验证命令、运维脚本）。
- `implementation/launch/launch-progress.md`：启动进度追踪（三应用状态、阻塞项 B1–B9 现状、提交分组进度、下一步顺序）。

### 基线结论

- T002–T024 的全部工作已进入版本控制：`1d19e70`（438 文件）并推送至 `origin/main`，远端与本地同一 commit；
  源码磁盘与 Git 完全一致（273/273、28/28、9/9）。
- `.env` 未被跟踪（`.gitignore:25`），入库的只有 `.env.example` 模板；已跟踪文件中无私钥、无平台令牌、
  无生产凭据（唯一的 `'<redacted>'` 是 `redactWeChatPayConfig()` 脱敏函数本身）。
- 无 `node_modules`、`dist`、`.next`、日志入库。
- 基线打上附注标签 `baseline-t024`（指向 `1d19e70`），作为可回滚锚点。

### 已知偏差

- T002–T024 落在单个提交中、提交信息为 "first commit"，不合 `AGENTS.md` §14 的粒度与格式要求；
  因 T025 明确禁止改写历史（`reset`/`rebase`/`--force`），保留该提交作为基线，后续提交按任务分组。
- `implementation/launch/launch-audit.md` 仍为 0 字节（审计产物落到了 `repository-audit.md` 与
  `git-baseline-audit.md`）；`user.name` 为空（由环境解析为 `张阳`），未改动 git 配置。

## T026 — Workspace 与 Build 修复

### 检查项

1. `pnpm-workspace.yaml`：`apps/*`、`packages/*`，5 个工作区包全部识别；`.npmrc` 正常。
2. 各 Workspace `package.json`：脚本齐全；`apps/miniprogram` 的 `build` 仅 `tsc --noEmit`（无产物）。
3. 包间依赖：`apps/api`、`apps/admin` 依赖 `@mentor/*`（`workspace:*`），无循环；重复声明但无版本冲突。
4. TypeScript：统一继承 `tsconfig.base.json`；`packages/*` 与 `apps/api` 的 build 配置均设 `rootDir: src` 并排除测试文件。
5. 构建脚本：根 `pnpm -r build` 按拓扑序执行。
6. 生成代码前置条件：Prisma Client 必须先生成（CI 中 `prisma:generate` 位于 `build` 之前，顺序正确）。
7. Prisma Client 生成：`prisma generate` 成功（v5.22.0），pnpm 下产物落在 `.pnpm` 存储路径，CLI 与 Client 版本一致。
8. 构建产物目录：`apps/api/dist`、`packages/*/dist`、`apps/admin/.next`、`*.tsbuildinfo` 均被 `.gitignore` 覆盖，无同名冲突。

### 失败与修复

- 现象：`pnpm build` 在 `apps/api` 失败 ——
  `Error [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":1100,"threshold":500,...,"targets":["apps/api/dist"]}`。
- 定位：`npx tsc -p tsconfig.build.json` 直接编译 **exit 0**，证明源码/依赖/配置无问题；失败来自
  `nest build` 依据 `apps/api/nest-cli.json` 的 `deleteOutDir: true` 在构建前整体删除 `dist/`。
- 定性：环境问题（工具链批量删除保护）为主因，仓库配置为触发条件。
- 修复（最小范围）：`apps/api/nest-cli.json` 的 `deleteOutDir` 改为 `false`。未触碰业务代码、数据库结构与测试。

### 验证结果

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS（`Already up to date`，锁文件一致） |
| `pnpm prisma:generate` | PASS（Prisma Client v5.22.0） |
| `pnpm build` | PASS（修复后；`apps/api`、`apps/admin` 均 Done） |
| `pnpm typecheck` | PASS（6 步全 Done） |
| `pnpm lint` | PASS |
| `pnpm format:check` / `pnpm test` | PASS（420 单测） |
| 构建产物冒烟 | PASS（`/health` 200、`/health/ready` 200 且 `database:"up"`） |

### 修改文件

- `apps/api/nest-cli.json`（`deleteOutDir: true` → `false`）
- `implementation/launch/build-verification.md`（新增）
- `implementation/progress.md`（本记录）

### 剩余问题

- `deleteOutDir: false` 后 `dist/` 可能残留旧产物（已忽略，CI 全新检出；需彻底重建时手动删除）。
- `next build` 存在 "Next.js plugin was not detected in your ESLint configuration" 非阻塞告警。
- 集成/E2E 未重跑（会重置测试库）；Redis 未接入（T028）；小程序无构建产物（T027）。

## T027 — 三端 API 契约审计与前端开发准备

### 交付（`implementation/frontend/`）

| 文件 | 内容 |
|---|---|
| `api-contract-map.md` | 按 13 个业务模块 + IM + 运维探针 + 职业复用，逐条列出 Method / Endpoint / 鉴权 / Request DTO / Response DTO / 错误码 / 对应 UI 页面 / 实现状态 / 测试证据 |
| `miniprogram-page-map.md` | 32 个小程序页面（家长 15 / 导师 12 / 职业 5）× API 映射，标注未成年人、支付、导师权限、mock 可用性 |
| `admin-page-map.md` | 14 个管理台页面 × API 映射与权限约束 |
| `frontend-implementation-plan.md` | 契约先行、先管理台后小程序、共享基建、F0–F6 阶段、风险与控制、验收口径 |
| `frontend-task-breakdown.md` | FE-01…FE-63 任务分解与推荐执行顺序 |

### 基线数字（当时）

- 后端路由 95 条；小程序可复用 56、管理台可复用 42
- 小程序页面 32（5 个 Tab 容器除外）、管理台页面 14
- 契约缺口 15 项（G1–G15），阻塞项 3 个：管理台登录（G1）、对象存储上传路由（G3）、IM 发消息（G4）

### 规则

不改后端代码、不改数据库、不创建前端页面、不虚构接口、不改状态机、不降低鉴权、不放密钥到前端。

## T027b — 补齐阻塞前端的三个后端缺口（G1 / G3 / G4）

### G1 管理台控制台登录

| 项 | 内容 |
|---|---|
| 新增接口 | `POST /auth/console/login`、`POST /admin/console-credentials`、`DELETE /admin/console-credentials/:userId` |
| 凭据存储 | 新表 `console_credentials`（迁移 `20261020090000_console_credentials`，仅新增，未改动既有表） |
| 口令 | `scrypt`（Node 内置，无新依赖），每凭据随机盐，恒定时间比较；长度 ≥12，用户名归一化为小写 |
| 失败处理 | 计数 + 5 次失败锁定 15 分钟；未知用户名/错误口令/非运营账号返回**同一**错误，不可枚举 |
| 权限 | 凭据只对**已持有** `ADMIN`/`OPS` 的账号生效：登录证明角色，不授予角色 |
| 限流 | `auth.console` 5 次/分钟/地址 |
| 审计 | `CONSOLE_CREDENTIAL_ISSUED`、`CONSOLE_CREDENTIAL_REVOKED`；快照为白名单，不含口令与哈希 |
| 测试 | 单元 `console-credential.spec.ts`（9）、集成 `console-auth-http.spec.ts`（2） |

### G3 对象存储上传/下载路由

| 项 | 内容 |
|---|---|
| 新增接口 | `PUT /files/verification/:caseId/:documentId?expires=&signature=`、`GET`（同路径） |
| 凭据 | 签名即凭证（HMAC 绑定 用途+对象 key+过期），秒级过期校验，下载 URL 不能当上传用 |
| 校验 | 类型白名单（`image/jpeg|png|webp`、`application/pdf`）、大小上限 `VERIFICATION_DOCUMENT_MAX_BYTES`、先查 `content-length` 再读流并设硬上限 |
| 生产形态 | 直连私有 bucket 时**不绑定**该路由（返回 404），API 形状不变 |
| 配套 | 全局 64 KiB 请求体上限对 `/files/` 豁免（该路由自行限大小） |
| 测试 | 单元 `files.controller.spec.ts`（5）、集成 `verification-files-http.spec.ts`（2） |

### G4 会话消息收发

| 项 | 内容 |
|---|---|
| 新增接口 | `POST /conversations/:id/messages`、`GET /conversations/:id/messages?limit=` |
| 内容归属 | 仍由传输适配器持有（`specs/09`），平台只落 `message_refs`（外部消息 id、发送者、类型、审核状态 PENDING） |
| 校验 | 成员、会话 OPEN、双向屏蔽；空消息/超长/未知字段被拒；`messages.send` 60 次/分钟/账号 |
| 测试 | 单元 `messages.spec.ts`（6）、集成 `messaging-messages-http.spec.ts`（2） |

### 验证结果

| 项 | 结果 |
|---|---|
| lint / format / typecheck / build | PASS |
| 单元测试 | **425 passed**（新增 20） |
| 集成测试 | **280 passed / 46 files**（新增 3 文件 6 用例） |
| E2E | **8 passed / 8 files** |
| 运行时冒烟 | 控制台登录 → `/me` → `/admin/dashboard` 200；消息发送与对方读取往返成功；伪造签名的上传 403 |
| 数据库 | 迁移已应用到开发库（仅新增一张表）；冒烟数据已清理（users=7 / roles=14 / creds=0 / convs=0 / refs=0 / sessions=0 / audits=0） |

### 未做 / 需你决定

- G2（公开单服务详情）、G5（订单时间线）、G6（前端埋点）、G7（结算收入）、G8（取消政策绑定订单）、G9/G15（通知与模板消息）、G10（订单争议接口）、G11（公开类目字典）、G12（儿童对导师受限可见）、G13（Dashboard 趋势）、G14（评价回复/申诉）仍缺失。
- Redis 版限流/幂等（原 T028 计划）未做，顺延为下一个工程任务。（此项原记于缺口闭环章节，该章现已编号 T027b。）

## T028 — 微信小程序工程初始化
### 交付

```
apps/miniprogram
├── app.ts / app.json / app.wxss              应用外壳：启动即完成一次 wx.login；5 个 Tab（首页/发现/消息/订单/我的）
├── pages/{home,discover,messages,orders,me}/ 每页 .ts/.wxml/.wxss/.json，含 loading/empty/error/retry/未登录
├── src/config.ts                             唯一部署配置项（API 原点；无密钥）
├── src/app-context.ts                        client + session 单例装配
├── src/core/{env,routes,envelope,errors,http,session,format}.ts   纯逻辑，Node 可测
├── src/platform/wechat.ts                    全部 wx.* 适配（request / login / storage）
├── src/services/{auth,discovery}.ts          登录、/me、公开导师列表与就绪检查
├── README.md / vitest.config.ts / package.json / tsconfig.json
```

### 设计要点

- **不引入运行时依赖**：小程序保留 `ROUTES` 副本（开发者工具无需构建 npm，workspace 软链在工具中不稳定），
  由 `src/core/routes.test.ts` 与 `@mentor/api-contracts` 的 `ENDPOINTS` 逐一比对做**漂移守卫**。
- **可测试性**：`wx.*` 只在 `src/platform/wechat.ts`；`ApiClient` 注入 transport，`SessionManager` 注入 store 与时钟，
  因此登录/刷新/登出全部可在 Node 中断言。
- **权限与状态机不下放**：只发 `code`，不请求角色；金额只格式化不计算；支付结果以后端状态为准。
- **隐私**：Storage 只存 access/refresh token；儿童数据、证件 URL 一律不落盘。
- `wx.request` 不支持 PATCH：适配器**显式报错**而不是降级为 POST。

### 验证

| 项 | 结果 |
|---|---|
| lint / format / typecheck / build | PASS |
| 单元测试 | 小程序 **38 passed**（env 4、format 6、envelope 5、errors 4、routes 5、http 7、session 7）；全仓库 **478 passed** |
| 实机之外的最小联调 | 用真实后端跑通：登录 → `/me` → `/providers` → `/health/ready` → 登出（Node 中以 fetch 作 transport）；冒烟数据已清理 |
| 未触碰 | 后端代码、数据库结构、既有测试 |

### 未实现（后续任务）

下单与支付、订单列表/详情、聊天、儿童档案、举报、导师入驻与验证页面（前端任务分解 FE-30 起）；
`project.config.json` 的 `appid` 仍为 `touristappid`，真机 `wx.login` 需替换为真实 AppID。

## T029 — 小程序「用户与认证」

### 交付

| 文件 | 内容 |
|---|---|
| `src/core/account.ts` | 账号视图模型：`describeAccount`（含"已停用"状态）、角色文案、`looksLikeGuardian`（仅提示，服务端裁决） |
| `src/core/consents.ts` | 同意记录：`isActive = granted && !revokedAt`（撤回后 `granted` 仍为 true）、类型文案、按时间倒序 |
| `src/services/profile.ts` | `getProfile` / `updateProfile`（仅 displayName、avatarUrl、cityCode、timezone）/ `listConsents` / `grantConsent` / `revokeConsent` |
| `pages/me/me.{ts,wxml,wxss}` | 「我的 / 隐私与设置」：账号卡（含停用提示）、资料查看与编辑、同意列表与撤回（二次确认）、退出登录；含 loading/empty/error/retry/未登录 |
| `src/core/routes.ts` | 新增派生路由 `meConsent = '/me/consents/:consentType'`，漂移测试断言它仍在 `meConsents` 之下 |

### 规则遵守

- 只发显示字段：`PUT /me/profile` 的请求体只含昵称/头像/城市/时区，不含 userId、role、status。
- 角色只展示不裁决：客户端不因角色隐藏入口，权限判断全在服务端（`specs/07`、`AGENTS.md` §7）。
- 撤回同意是**权利**：始终可达，且需二次确认（`specs/10` §consent withdrawal）。
- 停用账号显式展示，不假装可用。

### 验证

| 项 | 结果 |
|---|---|
| lint / format / typecheck / build | PASS |
| 单元测试 | 小程序 **61 passed**（新增 account 8、consents 7、profile 8 = 23）；全仓库 **501 passed** |
| 真实后端联调 | 登录 → `/me` → `GET /me/profile`（无监护人资料）→ `PUT`（昵称+城市生效，`hasGuardianDetails` 转 true）→ 同意：空 → 授予 PRIVACY v1（生效）→ 撤回（失效且 `revokedAt` 有值）→ 登出；冒烟数据已清理 |
| 未触碰 | 后端代码、数据库结构、既有测试 |

### 未实现

儿童档案（`/me/children`）、头像上传（需对象存储直传链路）、实名与手机号绑定（规范未定义），
以及导师侧资料；这些属于后续前端任务（FE-33 起）。

## T030 — 小程序「导师发现」

### 交付

| 文件 | 内容 |
|---|---|
| `src/core/filters.ts` | `ProviderFilter`：默认值、规范化（代码转大写、未知方式/排序回落、倒置价格区间丢弃）、`toSearchQuery`（只发已设值）、`activeFilterCount`、`filterSummary` 文案 chips |
| `src/core/paging.ts` | `appendPage`（按 id 去重，服务端分页漂移不产生重复行）、`hasMore` / `nextPage` / `resetWith` |
| `src/core/provider-view.ts` | `describeSearchItem` / `describeService` / `describeProviderDetail` / `describeReview` / `describeSlot`：逐字段从公开契约构造，金额只格式化 |
| `src/services/discovery.ts` | `searchProviders`（规范化后的筛选 + 分页）、`loadProviders`、`loadMoreProviders`、`canLoadMore`、`providerDetail`、`providerReviews`、`providerAvailability`、`loadProviderDetail`（三接口并行） |
| `pages/discover/*` | 列表 + 筛选面板（城市/科目/年级/价格/方式/仅已验证）+ 排序（综合/评分/最新）+ chips + 上拉加载更多 + 空/错误/重试 |
| `pages/provider/*` | 导师详情：服务（时长+价格+方式）、可预约时段、评价；含 loading/错误重试 |
| `app.json` | 注册 `pages/provider/provider`（非 Tab 页） |

### 规则遵守

- **没有关键词检索**：后端契约只有结构化筛选，因此不实现"假搜索"，也不在客户端二次过滤。
- 金额只展示：`minPriceMinor` / `priceMinor` 经 `formatMoney` 输出，客户端不计算。
- 只渲染公开 DTO：owner user id、approvalStatus、searchable、能力状态与限制范围均不出现。
- 未找到与无权限在客户端不可区分（`NOT_FOUND`），详情页统一提示并支持重试。
- 未改后端、未改库、未触碰既有测试。

### 验证

| 项 | 结果 |
|---|---|
| lint / format / typecheck / build | PASS |
| 单元测试 | 小程序 **89 passed**（新增 filters 8、paging 5、provider-view 8、discovery 7 = 28）；全仓库 **529 passed** |
| 真实后端联调 | 造一位可发现导师后：`GET /providers` 全量 1 条；`city=BEIJING` 1 条；`city=SHANGHAI` 0 条；`minPrice` 过高 0 条；行视图输出"¥200.00 起"；详情页返回服务（1 小时 / ¥200.00）、1 个时段、0 条评价；不存在的导师 → `NOT_FOUND 404` |
| 数据 | 冒烟数据已清理，开发库回到基线（users=7 / roles=14 / providers=0 / services=0 / slots=0 / cases=0 / terms=28 / audits=0 / consents=0） |

### 未实现

「服务详情」独立页面（后端无单服务接口，G2）、下单与支付、收藏/最近浏览、筛选字典下拉
（依赖公开类目接口 G11），均属后续前端任务。

## T031 — 小程序「预约与订单」

对应 `frontend-task-breakdown.md` 的 **FE-34（创建预约）** 与 **FE-36（订单列表与详情：取消、退款申请、退款进度）`；支付（FE-35）不在本任务内，订单详情对 `PENDING_PAYMENT` 只展示状态。

### 交付

| 层 | 文件 |
|---|---|
| 核心 | `src/core/booking.ts`（预约草稿 + 请求体）、`src/core/order-view.ts`（状态/金额/退款视图）、`src/core/children.ts`（孩子选项） |
| 服务 | `src/services/orders.ts`（下单、列表、详情、取消、退款申请、退款进度）、`src/services/profile.ts` 新增 `listChildren()` |
| 页面 | `pages/booking`（选服务/时段/孩子/备注）、`pages/order-detail`（金额屏 + 取消 + 退款申请 + 退款进度）、`pages/orders`（真实列表与加载更多）、`pages/provider`（预约入口：整导师 / 单个服务） |
| 平台 | `src/platform/wechat.ts` 新增 `navigateTo` / `redirectTo` / `showToast` / `confirm`，保持 `wx.*` 只在适配层 |
| 契约 | `packages/api-contracts` 的 `ENDPOINTS` 补齐 `orderDetail`、`orderCancel`，并纳入小程序路由漂移守卫 |

### 验收与证据

- **金额不由客户端决定**：`CreateOrderBody` 只有 `serviceId / childId / scheduledStart / scheduledEnd / note?`；测试断言序列化后的 body 不含 `amount|price|fee|currency|status`，且请求体与 `bookingRequest()` 完全一致（`orders.test.ts`）。
- **时段来自导师发布的槽位**：`slotOptions()` 只保留 `OPEN` 且未过期的槽并按开始时间排序，提交的是槽位自带的 `startAt/endAt`（T011 整槽占用，客户端不拼时间）。
- **金额屏完整**：订单详情展示服务、时长、单价、合计、订单号、时间、下单时间；单价取自 `priceSnapshot`，合计取自 `amountMinor`，即使两者不同也各自如实显示（不重算）。
- **状态只读**：取消与退款申请走命令端点；`ORDER_INVALID_STATE`(409) 的处理是刷新详情而不是重试写入（`order-detail.ts`）。
- **退款不带金额**：`POST /orders/:id/refund-request` 只发 `reason?`，服务端回答 `refundableMinor`；退款进度走 `GET /orders/:id/refunds`。
- **儿童最小化**：孩子选择器只显示昵称与年级，不渲染学校/学习目标/出生年份；`consentStatus !== 'GRANTED'` 的孩子不可选（`specs/10`）。
- **订单详情不泄露孩子**：订单只有 `childId`，文案只说"已关联/未关联孩子档案"。

### 测试

- 新增 45 个单测（订单视图 12、预约 11、孩子 5、订单服务 15、孩子列表 2），小程序单测 **89 → 134**，全仓库单测 574 通过。
- `format` / `lint` / `typecheck` 全部通过。

### 未做（后续任务）

- 支付与支付结果（FE-35）：`payment-session` / `payment-status`（建议 T032）。
- 订单时间线（G5）、评价（FE-37）、举报申诉（FE-38）、聊天入口（FE-50）。
- 导师侧接单（confirm/start/complete，FE-44）。

## T032 — 小程序「导师工作台」

对应 `frontend-task-breakdown.md` 的 **FE-40（入驻申请）**、**FE-42（服务管理与发布/下架）**、**FE-43（可用时间管理）**、**FE-44（接单与交付）**、**FE-46（验证状态页）**。

### 交付

| 层 | 文件 |
|---|---|
| 核心 | `src/core/provider-desk.ts`（档案/能力/验证/服务/时段视图 + 接单命令判定 + 入驻申请体）、`src/core/service-form.ts`（服务表单与分为单位的金额）、`src/core/slot-form.ts`（本地时间 → ISO） |
| 服务 | `src/services/provider-desk.ts`（档案、验证、入驻、提交审核、服务增删改发布、时段增删、confirm/start/complete） |
| 页面 | `pages/provider-desk`（含资料编辑）、`pages/provider-services`（含服务编辑）、`pages/provider-slots`、`pages/provider-orders`、`pages/provider-reviews`、`pages/provider-verification`；`pages/me` 新增「导师工作台」入口 |
| 契约 | `ENDPOINTS` 补齐 `providerServicePublish`、`providerServiceUnpublish`、`providerSlot`、`orderConfirm`、`orderStart`、`orderComplete`，并纳入路由漂移守卫 |

### 验收与证据

- **只读服务端决定的字段**：工作台展示 `approvalStatus`、`searchable`、能力状态、验证状态；提交/发布一律走命令端点，请求体中不含 `approvalStatus` / `searchable` / `userId` / `roles`（`provider-desk.test.ts` 断言）。
- **未通过审核不能发布**：`publishService` 走 `POST /providers/me/services/:id/publish`，服务端拒绝时页面显示服务端原因（不隐藏按钮、不本地预判）。
- **时段冲突由服务端裁决**：客户端不做重叠校验，冲突以错误提示呈现（T011 拥有该不变量）。
- **交付只有三个命令**：`PAID→confirm`、`CONFIRMED→start`、`IN_PROGRESS→complete`；409 走刷新而非重试。
- **金额是整数分**：`yuanToMinor()` 只接受整数或两位小数，`serviceRequest()` 输出的 `priceMinor` 为整数（测试断言 `Number.isInteger`）。
- **导师订单与家长订单分离**：`GET /orders` 返回参与方全部订单，工作台用 `providerId` 过滤出"我要交付的"（`providerOrdersOnly`）。

### 测试

- 新增 49 个单测（工作台 13、服务表单 15、时段表单 4、工作台服务 15、评价列表 2），小程序单测 **134 → 183**，全仓库单测 623 通过。
- `format` / `lint` / `typecheck` 全部通过。

### 本轮追加（解法 1 的两项）

- **资料与服务编辑**：后端新增 `PUT /providers/me`（`ReplaceProviderProfileDto`）与 `PUT /providers/me/services/:id`（`ReplaceServiceDto`）——整表替换语义，PATCH 原样保留；前端工作台"编辑资料"与服务页"编辑"走 PUT，省略字段即清空。集成测试覆盖：替换生效、省略字段被清空、`approvalStatus`/`searchable` 仍被拒绝、已发布服务不可编辑。
- **证件上传（FE-41）**：`fileHash` 改为可选（仍校验 SHA-256 格式），`verification_documents.file_hash` 改为可空（迁移 `20261023100000_verification_document_hash_optional`），`PUT /files/verification/...` 收到字节后由服务端计算并记录哈希（首次上传为准）；小程序 `pages/provider-verification` 走"建用例 → 签名 URL 直传 → 提交"，不传哈希、不缓存证件。

### 缺口（未做，需决策）

- ~~**资料编辑（FE-40 的编辑部分）不可用**~~ → **已解决（解法 1）**：后端补 `PUT /providers/me` 与 `PUT /providers/me/services/:id`（整表替换，PATCH 保留），前端资料与服务编辑已实现并测试。
- ~~证件上传（FE-41）阻塞~~ → **已解决（解法 1）**：`fileHash` 改为可选，`verification_documents.file_hash` 改为可空（迁移 `20261023100000_verification_document_hash_optional`），由服务端在收到字节后计算并记录 SHA-256；小程序 `pages/provider-verification` 完成"建用例 → 签名 URL 直传 → 提交"链路。
- **收益（特性开关）**：后端无对应接口（缺口 G7），前端无数据可渲染。
- **导师 IM（FE-50）**、**职业赛道（FE-51）**、**支付（FE-35）**：各自为独立任务，未纳入 T032。
- 支付（FE-35）仍待做（T032 未包含）。

## T033 — 管理后台

对应 `frontend-task-breakdown.md` 的 **FE-01…FE-06（共享基建）** 与 **FE-10、FE-11、FE-12、FE-13、FE-15、FE-18、FE-19、FE-20、FE-21、FE-22**（管理台）。
FE-14（教师合规）、FE-16（举报队列）、FE-17（申诉终审）不在本任务内，留待下一个管理台任务。

### 交付

| 层 | 文件 |
|---|---|
| 基建 | `apps/admin/src/lib/env.ts`（唯一设置：API 地址）、`http.ts`（`{data}` 解包、`X-Request-Id`、类型化错误）、`errors.ts`（错误码 → 文案/动作）、`session.ts`（会话序列化，纯函数） |
| 客户端 | `apps/admin/src/lib/client.ts`：`/admin/*` 全部用例（dashboard、商家处置、验证处置与证件访问、订单与退款、用户角色、审计日志、开关、类目、规则、控制台凭据） |
| 视图 | `apps/admin/src/lib/views.ts`：KPI 卡片与各行视图模型、金额/时间/万分比格式化 |
| 动作 | `apps/admin/src/lib/actions.ts`：全部写操作为 server action（理由必填、退款带幂等键、开关与发布二次确认） |
| 页面 | `app/login`；`app/(console)/` 下 dashboard、providers、verifications、orders、users、audit、flags、taxonomy、rules，共 12 条路由 |
| 契约 | `ENDPOINTS` 补齐 `adminBootstrap`、`adminProviderApprove/Reject`、`adminUserRole`、`adminVerificationApprove/Reject/DocumentAccess`、`taxonomyTerm(Archive)`、`adminConsoleCredential` |

### 验收与证据

- **令牌不出服务端**：会话存 httpOnly + sameSite cookie，所有请求在服务端发起（浏览器不持令牌、无 CORS）；`session.test.ts` 覆盖序列化与过期判定。
- **处置必填理由**：`decideProvider` / `decideVerification` 在客户端就拒绝空理由（服务端同样要求），`client.test.ts` 断言请求体携带 `reason` / `reasonCode`。
- **证件私有**：查看证件走 `POST /admin/verifications/:id/documents/:documentId/access-url`，固定 `reasonCode:'REVIEW'`，返回短时 URL，不缓存。
- **退款幂等**：`refundOrder` 必带 `Idempotency-Key`；金额留空即"服务端认定的可退金额"，只有运营明确部分退款时才带 `amountMinor`。
- **类目只归档**：只有 `archive` 命令，没有删除入口（`specs/01` §Catalog）。
- **规则显式发布**：草稿可编辑，发布为独立二次确认命令。
- **403 可见而非隐藏**、**错误显示为平台文案而非堆栈**：`AdminApiError` 统一承载 code/action，`client.test.ts` 断言。
- **概览不造假**：只展示 `AdminDashboardCounts` 返回字段，无趋势图（后端无时间序列接口，G6/G13）。

### 测试

- 管理台单测 **2 → 36**（客户端 18、视图 13、会话 4、环境 2，含原有 2 条）。
- `pnpm --filter @mentor/admin build` 通过：12 条路由（`/`、`/login` 与 9 个运营页 + 404）。
- `format` / `lint` / `typecheck` 全部通过。

### 未做（下一个管理台任务）

- FE-14 教师合规队列（start-review / approve / restrict / reject / suspend，限制范围可配置）。
- FE-16 举报队列与处置（含调查流转）、FE-17 申诉终审（禁止原处置人执行，前端提前禁用）。
- 分页控件（当前每页 50，仅首页）、列表筛选（除审计日志外未做）。

## T034 — Redis 与依赖完善

对应仓库审计的阻塞项 **B3（Redis 未接入）**，以及工程基线中的依赖一致性要求。

### 交付

| 层 | 文件 |
|---|---|
| 客户端 | `apps/api/src/infrastructure/redis/redis.client.ts`：`REDIS_URL` 解析（空/`disabled` 即不启用）、ioredis 句柄、窄命令面 `RedisLike`、命名空间 `mentor:*`、`onModuleDestroy` 优雅关闭 |
| 限流 | `apps/api/src/common/security/redis-rate-limiter.ts`：共享固定窗口（`INCR` + 首次 `EXPIRE` + `TTL` 给出 Retry-After），失败降级到 `InMemoryRateLimiter` |
| 幂等 | `apps/api/src/common/idempotency/redis-idempotency.store.ts` + `idempotency-store.factory.ts`：`SET NX EX` 抢占 + 结果落库重放、指纹不一致 → `IDEMPOTENCY_CONFLICT`、`work` 失败即释放声明、并发重试短暂等待后拒绝（绝不重复执行） |
| 接线 | `RedisModule`（`@Global()`，提供 `REDIS` 句柄）；`SecurityModule`、`PaymentsModule`、`RefundsModule` 以 **optional 注入** 使用，模块单独构建时自动回到内存实现 |
| 运维 | `ops/redis.md`（用途、键与 TTL、降级行为、多实例要求、验证方法），`ops/README.md` 与 `implementation/launch/environment.md` 同步 |
| 依赖 | 新增 `ioredis ^6`；根 `package.json` 保持 `engines.node >=20` 与 `packageManager`，`pnpm install --frozen-lockfile` 通过 |

### 验收与证据

- **共享计数**：两个实例/重启后读同一计数器（单测以 fake Redis 断言 `INCR`/`EXPIRE`/`TTL` 序列）。
- **共享幂等**：首次执行并落结果，重试回放同一答案（单测断言 `replayed: true` 且第二次 `work` 未执行）。
- **失败即释放**：`work` 抛错时 `DEL` 声明，重试能再次执行（单测）。
- **同键异载 = 冲突**：指纹不同抛 `IdempotencyConflictError`，绝不回放无关答案（单测）。
- **Redis 不可用不成灾**：`enableOfflineQueue: false` + 有限重试（>3 次放弃），失败降级并只记一次告警；本地 `.env` 配了 `REDIS_URL` 但无 Redis 服务时，集成 282 与 E2E 8 全部通过且不挂起。
- **依赖可复现**：`pnpm install --frozen-lockfile` 通过（锁文件与清单一致）。

### 测试

- 新增 18 个单测（限流 5、幂等 7、客户端 6），api 单测 **427 → 445**。
- 集成 **46 文件 / 282 测试**全部通过；E2E **8/8** 通过；`format`/`lint`/`typecheck` 通过。

### 未做

- 分布式锁仍未使用 Redis（可用性占用是 PostgreSQL 事务内条件更新，T011）；有意如此。
- 未引入 Redis 缓存与队列；未测试 sentinel/cluster 拓扑。
- 未做"连真实 Redis 的集成测试"（本机无 Redis 服务）；以 fake 断言 + `ops/redis.md` 的人工验证步骤替代。
