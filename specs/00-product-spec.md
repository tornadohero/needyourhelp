# Product Spec

## 1. Product

Working name: Mentor Platform.

Positioning:
A trusted marketplace connecting verified education/career mentors with families and university students.

## 2. Personas

### Parent/Guardian
Needs:
- Find suitable tutor.
- Compare verified profiles.
- Communicate before purchase.
- Book and pay.
- Manage child profiles.
- Review/report/dispute.

### Student
Needs:
- Find tutoring.
- Find career mentors.
- Manage goals and orders.

### University Tutor
Needs:
- Apply.
- Verify identity/education.
- Publish service profile.
- Set subjects, grades, price, availability.
- Receive orders.
- Deliver and receive reviews.

### Teacher Provider
Needs:
- Apply with controlled visibility.
- Verification/compliance review.
- Publish professional profile without mandatory public photo.
- Receive only permitted orders.

### Career Mentor
Needs:
- Verify professional profile.
- Publish expertise.
- Set service/price/availability.
- Consult students.

### Admin/Ops
Needs:
- Review providers.
- Manage users/services/orders/refunds/reports.
- Moderate content.
- Manage platform rules and audit.

## 3. V1 scope

### Must have
- WeChat login.
- Parent profile.
- Child profile with guardian relationship.
- Provider onboarding.
- Identity/education verification workflow.
- Provider public profile.
- Subject/skill taxonomy.
- Service listing.
- Search/filter.
- Provider detail.
- Conversation entry.
- Availability slots (basic create/list/delete; required because `specs/01-business-rules.md` allows order creation only against valid service availability).
- Booking/order.
- WeChat payment adapter.
- Order lifecycle.
- Review.
- Report/block.
- Admin console.
- Audit logs.
- Privacy/consent records.
- Feature flags.
- Basic analytics.

### V1.1
- Availability calendar UI (visual scheduling, drag-to-edit and recurrence editing; basic slot CRUD is already in V1).
- Provider earnings/settlement.
- Refund workflow.
- Coupons.
- Career mentor marketplace enablement.
- Better matching.

### Later
- AI matching.
- AI career planning.
- AI resume analysis.
- AI interview practice.
- Recommendation explanations.
- Multi-city growth.
- Native app.

## 4. Explicit non-goals for V1

- Native iOS/Android apps.
- Self-built IM infrastructure.
- Elasticsearch.
- Microservices.
- Automated teacher qualification approval.
- Automated identity verification decisions without human review.
- AI-only moderation.
- Public display of child personal information.
- Open public contact information.
- Complex subscription/membership.
- Multi-party escrow/financial products.

## 5. Primary journeys

### Tutor discovery
Home -> Find Tutor -> filters -> list -> profile -> service -> chat -> booking -> payment -> order -> completion -> review.

### Provider onboarding
Login -> Apply -> identity -> education -> profile -> service -> submit -> admin review -> approved -> publish.

### Career mentor
Feature flag -> Find Mentor -> profile -> service -> chat -> booking -> payment -> completion -> review.

## 6. Product principles

1. Trust before growth.
2. Transaction before feature breadth.
3. Provider quality over provider quantity.
4. Minimum necessary data.
5. Human review for consequential moderation/appeal decisions.
6. Every money movement is traceable.
7. Platform rules are versioned.
