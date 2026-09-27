# Admin and Operations Spec

## Admin principles

- Least privilege.
- Every mutation audited.
- No silent data edits.
- Dangerous operations require confirmation.
- Financial operations require reason.
- Identity-document access is logged.
- Search results are minimized by role.

## Provider review workflow

Queue:
- newest first
- risk flags first
- incomplete cases

Review:
- profile
- identity verification result
- education evidence
- teacher compliance if applicable
- service content
- public visibility

Actions:
- approve
- reject
- request resubmission
- restrict
- suspend

## Order operations

Admin can:
- view
- investigate
- cancel when policy permits
- initiate refund when authorized
- mark dispute
- view payment reconciliation

Admin cannot directly mutate `PAID` to `COMPLETED` without an explicit audited operational command.

## Moderation

Report categories:
- fraud
- harassment
- inappropriate content
- off-platform transaction
- fake credentials
- unsafe behavior
- payment issue
- other

## Audit

Audit every:
- role change
- provider decision
- verification decision
- service publication override
- refund
- settlement
- moderation action
- platform rule publication
- feature flag production change
