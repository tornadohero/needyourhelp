# Architecture Spec

## Architecture

Modular monolith:

```text
Mini Program ───────┐
                    ├── API ── Auth ── Domain Modules ── PostgreSQL
Admin Web ──────────┘                 │
                                      ├── Redis
                                      ├── Object Storage
                                      ├── Payment Adapter
                                      ├── IM Adapter
                                      └── Verification Adapter
```

## Backend modules

```text
auth
users
profiles
children
providers
verification
catalog
services
search
availability
orders
payments
refunds
settlements
reviews
messaging
reports
moderation
notifications
admin
audit
feature-flags
platform-rules
```

## Layers

```text
controller
  -> application use case
     -> domain service / aggregate
        -> repository interface
           -> infrastructure adapter
```

## External provider ports

```ts
interface PaymentGateway {
  createMiniProgramPayment(input): Promise<PaymentSession>;
  queryPayment(input): Promise<PaymentStatus>;
  refund(input): Promise<RefundResult>;
}

interface IdentityVerificationGateway {
  submit(input): Promise<VerificationSubmission>;
  query(input): Promise<VerificationResult>;
}

interface MessagingGateway {
  createConversation(input): Promise<ConversationRef>;
  sendSystemMessage(input): Promise<void>;
  blockUser(input): Promise<void>;
}

interface ObjectStorage {
  createUploadUrl(input): Promise<SignedUpload>;
  createDownloadUrl(input): Promise<SignedDownload>;
}
```

## API

Base `/api/v1`.

JSON.
Errors:

```json
{
  "code": "ORDER_NOT_PAYABLE",
  "message": "Order cannot be paid in its current state.",
  "requestId": "..."
}
```

## Idempotency

Required:
- POST order
- POST payment
- payment callback
- POST refund
- settlement
- verification submission

Header:
`Idempotency-Key`.

## Observability

- structured logs
- request ID
- error tracking
- latency metrics
- DB query metrics
- payment callback metrics
- order conversion metrics
- audit log

## Deployment

Recommended:
- managed PostgreSQL
- managed Redis
- managed object storage
- one backend container/service initially
- one admin web deployment
- one mini-program release channel
- CI/CD through GitHub Actions

## Environments

`local`, `dev`, `staging`, `prod`.

No production secrets in repository.

## Feature flags

- `career_marketplace_enabled`
- `teacher_provider_enabled`
- `wechat_payment_enabled`
- `im_enabled`
- `ai_matching_enabled`
- `settlement_enabled`
