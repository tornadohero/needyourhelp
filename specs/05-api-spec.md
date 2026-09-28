# API Spec

All endpoints under `/api/v1`.

## Auth

`POST /auth/wechat/login`
Input: `{ code }`
Output: session tokens + basic user profile.

`POST /auth/refresh`
`POST /auth/logout`
`GET /me`

## Profile

`GET /me/profile`
`PUT /me/profile`

`POST /me/children`
`GET /me/children`
`GET /me/children/:id`
`PATCH /me/children/:id`
`DELETE /me/children/:id`

## Provider

`POST /providers/applications`
`GET /providers/me`
`PATCH /providers/me`
`POST /providers/me/submit`

`GET /providers`
Query:
- domain
- city
- providerType
- subject
- grade
- deliveryMode
- minPrice
- maxPrice
- verifiedOnly
- page
- pageSize
- sort

`GET /providers/:id`

`GET /providers/:id/services`

## Verification

`POST /verification/cases`
`POST /verification/cases/:id/documents/upload-url`
`POST /verification/cases/:id/submit`
`GET /verification/me`

## Services

`POST /providers/me/services`
`GET /providers/me/services`
`PATCH /providers/me/services/:id`
`POST /providers/me/services/:id/publish`
`POST /providers/me/services/:id/unpublish`

## Availability

`POST /providers/me/availability`
`GET /providers/:id/availability`
`DELETE /providers/me/availability/:id`

## Orders

`POST /orders`
Input:
```json
{
  "serviceId": "uuid",
  "childId": "uuid|null",
  "scheduledStart": "ISO",
  "scheduledEnd": "ISO",
  "note": "..."
}
```

Server derives price.

`GET /orders`
`GET /orders/:id`
`POST /orders/:id/cancel`
`POST /orders/:id/confirm`
`POST /orders/:id/start`
`POST /orders/:id/complete`

## Payments

`POST /orders/:id/payment-session`
Returns provider-specific payment parameters.

`POST /payments/wechat/notify`
Server-to-server callback.

`GET /orders/:id/payment-status`

## Refund

`POST /orders/:id/refund-request`
`GET /orders/:id/refunds`

## Reviews

`POST /orders/:id/reviews`
`GET /providers/:id/reviews`

## Messaging

`POST /conversations`
`GET /conversations`
`GET /conversations/:id`
`POST /conversations/:id/report`
`POST /users/:id/block`
`DELETE /users/:id/block`

The actual message transport is provided by IM adapter.

## Reports

`POST /reports`
`GET /me/reports`

## Admin

All admin routes require admin permissions.

`GET /admin/dashboard`
`GET /admin/users`
`GET /admin/providers`
`GET /admin/verifications`
`POST /admin/verifications/:id/approve`
`POST /admin/verifications/:id/reject`
`POST /admin/providers/:id/suspend`
`POST /admin/providers/:id/restore`
`GET /admin/orders`
`POST /admin/orders/:id/refund`
`GET /admin/reports`
`POST /admin/reports/:id/resolve`
`GET /admin/audit-logs`
`GET /admin/feature-flags`
`PATCH /admin/feature-flags/:key`
`GET /admin/platform-rules`
`POST /admin/platform-rules`
`POST /admin/platform-rules/:id/publish`

### Taxonomy

`GET /admin/taxonomy`
Query:
- type (`SUBJECT|GRADE|SKILL|CITY`)
- parentId
- active
- page
- pageSize

`POST /admin/taxonomy`
`PATCH /admin/taxonomy/:id`
`POST /admin/taxonomy/:id/archive`

Notes:
- Taxonomy terms are archived (set `active=false`), never hard-deleted, because `service_terms` references them and historical orders depend on the taxonomy snapshot.
- Every taxonomy mutation is audited (see `specs/12-admin-spec.md` and task T008).

## Error codes

`AUTH_REQUIRED`
`FORBIDDEN`
`NOT_FOUND`
`VALIDATION_ERROR`
`PROVIDER_NOT_APPROVED`
`SERVICE_NOT_PUBLISHED`
`ORDER_NOT_PAYABLE`
`ORDER_INVALID_STATE`
`PAYMENT_FAILED`
`PAYMENT_CALLBACK_INVALID`
`REFUND_NOT_ALLOWED`
`REVIEW_NOT_ELIGIBLE`
`BLOCKED_USER`
`CONSENT_REQUIRED`
`CHILD_ACCESS_DENIED`
`RATE_LIMITED`
`IDEMPOTENCY_CONFLICT`
