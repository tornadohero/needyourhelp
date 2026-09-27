# Analytics Spec

Track events with minimal personal data.

## Funnel

### Parent
`home_viewed`
`search_started`
`provider_list_viewed`
`provider_detail_viewed`
`chat_started`
`booking_started`
`order_created`
`payment_started`
`payment_succeeded`
`order_completed`
`review_submitted`

### Provider
`application_started`
`application_submitted`
`verification_submitted`
`provider_approved`
`service_published`
`inquiry_received`
`order_received`
`order_completed`

## Core metrics

- search -> detail CTR
- detail -> chat CTR
- chat -> order conversion
- payment success rate
- completion rate
- repeat purchase rate
- provider approval rate
- median verification time
- refund rate
- report rate
- review rate

Do not use child name/identity as analytics dimensions.
