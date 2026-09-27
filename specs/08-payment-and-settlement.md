# Payment, Refund and Settlement

## Payment architecture

Use adapter:

```text
Order
 -> PaymentApplicationService
 -> PaymentGateway
 -> WeChat Mini Program Pay
```

The client callback is informational only.
Server confirms through payment notification/query.

The current WeChat payment documentation describes the mini-program flow as server-side order creation, client `requestPayment`, followed by server-side notification and/or query confirmation. See official docs:
- https://pay.wechatpay.cn/doc/v3/merchant/4012791911
- https://pay.wechatpay.cn/doc/v3/merchant/4015459512

## Create payment

1. Verify authenticated buyer.
2. Verify order ownership.
3. Verify order state.
4. Recalculate amount.
5. Create payment record with idempotency key.
6. Call gateway.
7. Return prepay parameters.
8. Client invokes WeChat payment.
9. Gateway notifies server.
10. Verify signature/decryption.
11. Check amount/order/provider transaction.
12. Atomically mark payment success and order `PAID`.
13. Emit `PaymentSucceeded`.

## Payment invariants

- Amount mismatch => reject callback.
- Duplicate callback => idempotent success.
- Unknown order => log and reject.
- Invalid signature => reject and security alert.
- Client saying "success" does not mark order paid.
- Never store payment secrets in DB.
- Never trust client amount.

## Refund

Refund request:
- validate order state/policy;
- calculate refundable amount server-side;
- create refund;
- invoke gateway;
- confirm result;
- mark refund;
- update order;
- audit.

## Settlement

V1 can delay provider settlement until operational/legal/payment model is finalized.
If enabled:
- settlement batch references captured orders;
- refunds/disputes reduce settlement;
- settlement amount is immutable after payout except correction record;
- every settlement has reconciliation status.

## Money model

Use:
`amount_minor INTEGER`
`currency VARCHAR(3)`.

For CNY:
`10000` = ¥100.00.

Never use floating point.
