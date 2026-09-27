# Test Strategy

## Pyramid

1. Domain unit tests
2. Application service tests
3. Repository/integration tests
4. API contract tests
5. E2E critical flows
6. Security regression tests

## Mandatory unit suites

- provider state transitions
- teacher compliance
- order state machine
- price calculation
- refund calculation
- review eligibility
- permission checks
- child access
- ranking/filtering

## API tests

For every protected endpoint:
- authenticated success
- unauthenticated failure
- wrong-role failure
- wrong-resource-owner failure
- invalid input
- rate limit where relevant.

## E2E

### E2E-01 parent tutoring
login -> create child -> search -> provider detail -> create order -> payment mock success -> confirm -> complete -> review

### E2E-02 provider onboarding
login -> application -> verification submission -> admin approve -> service publish -> discoverable

### E2E-03 teacher restriction
teacher -> identity approved -> compliance pending -> not orderable -> compliance approved -> orderable

### E2E-04 payment replay
same callback twice -> one successful state transition

### E2E-05 price tamper
client sends altered amount -> server rejects/uses server price

### E2E-06 child isolation
parent A child cannot be read by parent B or provider not associated with eligible order.

### E2E-07 admin audit
admin action -> audit record exists.

### E2E-08 refund
paid order -> eligible refund -> refund success -> order/payment state consistent.

## Definition of done

- all relevant tests pass
- no critical/high security regression
- migrations reproducible
- seed works
- API docs updated
- no secrets
