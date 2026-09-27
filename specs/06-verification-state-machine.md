# Verification and Approval State Machines

## Identity verification

```text
DRAFT
  -> SUBMITTED
  -> UNDER_REVIEW
  -> APPROVED
  -> REJECTED
  -> RESUBMITTED
```

Terminal only after admin policy:
`REJECTED` can be resubmitted.

## Provider application

```text
DRAFT
 -> SUBMITTED
 -> UNDER_REVIEW
 -> APPROVED
 -> REJECTED
```

Suspension is orthogonal:
`ACTIVE -> SUSPENDED -> ACTIVE`.

## Teacher compliance

```text
NOT_REQUIRED
PENDING
UNDER_REVIEW
APPROVED
RESTRICTED
REJECTED
```

Rules:
- `identity=APPROVED` is not sufficient.
- `education=APPROVED` is not sufficient.
- Teacher capability is orderable only if compliance state permits the specific service.
- Restriction can be category/time/location specific through `restriction_json`.

## Service publication

```text
DRAFT -> PENDING_REVIEW -> PUBLISHED
                         -> REJECTED -> DRAFT
PUBLISHED -> UNPUBLISHED
```

## Order

```text
PENDING_PAYMENT
  -> PAID
  -> CONFIRMED
  -> IN_PROGRESS
  -> COMPLETED

PENDING_PAYMENT -> CANCELLED
PAID -> REFUND_PENDING -> REFUNDED
PAID/CONFIRMED/IN_PROGRESS -> DISPUTED
```

State transitions must be explicit commands, not arbitrary PATCH of status.

## Moderation

```text
OPEN
 -> INVESTIGATING
 -> ACTION_REQUIRED
 -> RESOLVED
 -> APPEALED
 -> FINALIZED
```

Appeal must be independently reviewed where feasible.

## Admin decision requirements

Every approve/reject/suspend/refund/moderation decision requires:
- actor
- timestamp
- reason code
- optional notes
- target resource
- before/after snapshot
- audit log
