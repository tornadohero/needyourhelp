# Domain Model

## Bounded contexts

```text
Identity
  User
  Role
  Session
  Consent

Profile
  ParentProfile
  StudentProfile
  ProviderProfile
  CareerProfile

Verification
  VerificationCase
  VerificationDocument
  VerificationDecision

Catalog
  Category
  Subject
  Skill
  Service
  ServiceTag

Tutoring
  ChildProfile
  Availability
  Booking
  Order

Career
  CareerGoal
  MentorCapability

Commerce
  Order
  Payment
  Refund
  Settlement
  PlatformFee

Communication
  Conversation
  ConversationMember
  MessageReference

Trust
  Review
  Report
  Block
  ModerationCase

Admin
  AuditLog
  FeatureFlag
  PlatformRule
```

## Aggregates

### User aggregate
Owns account status, roles and consent references.

### Provider aggregate
Owns provider public profile, capabilities and publication status. Verification is a separate aggregate.

### Service aggregate
Owns sellable service configuration and price.

### Order aggregate
Owns commercial lifecycle. It is the source of truth for order status.

### Payment aggregate
Tracks external payment lifecycle. It never decides business fulfillment alone.

### Review aggregate
References a completed order and reviewer/reviewee.

## State invariants

- Provider cannot publish before approval.
- Service cannot be ordered unless provider and service are active.
- Order cannot become `COMPLETED` before `PAID`.
- Refund cannot exceed captured amount.
- Settlement cannot exceed captured amount minus refund/fee.
- Review cannot be created for an ineligible order.
- Admin state changes require audit.

## Domain events

`UserRegistered`
`ProviderApplicationSubmitted`
`VerificationSubmitted`
`ProviderApproved`
`ProviderRejected`
`ServicePublished`
`OrderCreated`
`PaymentSucceeded`
`PaymentFailed`
`OrderConfirmed`
`OrderCompleted`
`RefundRequested`
`RefundSucceeded`
`ReviewSubmitted`
`ReportCreated`
`ProviderSuspended`

Events are internal first; an event bus is optional in V1.
