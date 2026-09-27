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
