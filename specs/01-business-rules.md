# Business Rules

## Account and roles

- `USER` is the base account.
- Roles: `PARENT`, `STUDENT`, `PROVIDER`, `ADMIN`, `OPS`, `FINANCE`, `MODERATOR`.
- One account can have multiple roles.
- Provider capability types: `STUDENT_TUTOR`, `GRADUATE_TUTOR`, `PHD_TUTOR`, `TEACHER`, `CAREER_MENTOR`.

## Provider approval

A provider is discoverable only when:
- account active;
- provider profile active;
- required verification approved;
- capability-specific compliance checks passed;
- at least one published service exists;
- no blocking suspension exists.

Identity verified != provider approved.

## Student tutor

Required:
- legal identity verification;
- education verification;
- profile;
- at least one skill;
- service;
- availability/contact preferences.

Photo:
- optional;
- visibility configurable.

## Teacher provider

- Photo optional.
- Employer/school details must have configurable visibility.
- Teacher capability requires compliance review.
- System must support `PENDING`, `APPROVED`, `RESTRICTED`, `REJECTED`, `SUSPENDED`.
- Admin must record review reason and evidence reference.
- The product must not represent a teacher as permitted to provide a service solely because identity/education is verified.

## Service

Fields:
- title
- category
- subjects/skills
- target grades/audience
- delivery mode
- duration
- price
- description
- cancellation policy
- active status.

Price is server authoritative.

## Orders

An order can only be created for:
- active provider;
- approved service;
- valid customer;
- valid service availability;
- valid price.

Order status:
`PENDING_PAYMENT -> PAID -> CONFIRMED -> IN_PROGRESS -> COMPLETED`

Non-terminal intermediate state:
`REFUND_PENDING` (`PAID -> REFUND_PENDING -> REFUNDED`, see `specs/06-verification-state-machine.md`).

Terminal:
`CANCELLED`, `REFUNDED`, `DISPUTED`.

## Review

- Only customer who paid for and completed an eligible order can review.
- Provider can review customer only if enabled by policy.
- Review must not reveal child sensitive data.
- Review moderation may hide content but must preserve audit trail.

## Cancellation/refund

Refund policy must be configurable by service/category/platform rule.
Do not hard-code percentages in client.
Server calculates refund eligibility and amount.

## Communication

- Chat is linked to a user pair and optionally a service/order.
- Direct contact information must be protected by moderation/rules.
- Blocked users cannot initiate new conversations.
- Reports are linked to conversation/message/user/order.

## Ranking

Default V1 ranking:
1. approved status
2. exact subject match
3. grade match
4. city/remote match
5. service availability
6. rating count/rating
7. price range fit
8. recent activity

Do not present ranking as an objective quality score. It is a retrieval ordering.

## Pricing

- Money is stored in integer minor units.
- Platform fee is calculated server-side.
- Provider payout is calculated server-side.
- Every fee version is recorded with the order.

## Privacy

- Public profile contains only approved public fields.
- Child identity data is private.
- Sensitive verification documents are private.
- Access to private verification documents is permissioned and audited.
