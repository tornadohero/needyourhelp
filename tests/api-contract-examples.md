# API Contract Examples

## Create order

POST `/api/v1/orders`

Request:
```json
{
  "serviceId": "01J...",
  "childId": "01J...",
  "scheduledStart": "2026-10-01T10:00:00+08:00",
  "scheduledEnd": "2026-10-01T11:00:00+08:00"
}
```

Response:
```json
{
  "data": {
    "orderId": "01J...",
    "orderNo": "MP202610010001",
    "status": "PENDING_PAYMENT",
    "amountMinor": 30000,
    "currency": "CNY"
  },
  "requestId": "req_..."
}
```

## Provider detail

GET `/api/v1/providers/:id`

Response must never include:
- ID card number
- identity documents
- private phone
- private address
- internal moderation notes.

## Error

```json
{
  "error": {
    "code": "PROVIDER_NOT_APPROVED",
    "message": "Provider is not currently available for booking."
  },
  "requestId": "req_..."
}
```
