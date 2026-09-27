# Pages and UI Spec

## Mini Program navigation

Tab 1 Home
Tab 2 Discover
Tab 3 Messages
Tab 4 Orders
Tab 5 Me

## Parent pages

- Home
- Tutor search
- Filter sheet
- Tutor list
- Tutor detail
- Service detail
- Chat
- Create booking
- Order confirmation
- Payment
- Order detail
- Review
- Child profiles
- Reports/complaints
- Privacy/settings

## Provider pages

- Provider onboarding
- Identity verification
- Education verification
- Profile editor
- Service editor
- Availability
- Orders
- Earnings (feature flag)
- Reviews
- Verification status
- Chat
- Settings

## Career pages

- Mentor discovery
- Mentor detail
- Career service detail
- Career order
- Career mentor dashboard

Hidden unless `career_marketplace_enabled=true`.

## Admin Web

### Dashboard
KPIs:
- users
- active providers
- pending verification
- orders
- GMV
- refund rate
- reports
- conversion

### Provider review
- queue
- identity status
- education status
- teacher compliance
- public profile preview
- approve/reject/restrict/suspend

### Orders
- search
- status
- payment
- refund
- dispute
- timeline

### Moderation
- reports
- conversation context permitted by policy
- action
- appeal
- audit

### Platform configuration
- taxonomy
- fees
- cancellation policies
- feature flags
- platform rules
- content

## UX requirements

Every async screen has:
- loading
- empty
- error
- retry
- permission denied
- offline/timeout where relevant.

Money screens must show:
- service
- duration
- price
- platform fee only if customer-facing policy requires
- total
- cancellation/refund rule link
- order number

Never hide material fee/refund terms.
