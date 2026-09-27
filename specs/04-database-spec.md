# Database Spec

PostgreSQL. Prisma recommended.

## ER overview

```text
users 1---N user_roles N---1 roles
users 1---1 parent_profiles
users 1---N child_profiles
users 1---N provider_profiles
provider_profiles 1---N provider_capabilities
provider_profiles 1---N verification_cases
provider_profiles 1---N services
services N---N taxonomy_terms
users 1---N orders
child_profiles 1---N orders
services 1---N orders
orders 1---N payments
orders 1---N refunds
orders 1---N reviews
users 1---N reviews
users N---N conversations
conversations 1---N message_refs
users 1---N reports
users 1---N blocks
users 1---N audit_logs
```

## Core tables

### users
- id UUID PK
- status enum
- wechat_openid_hash unique nullable
- unionid_hash nullable
- display_name
- avatar_url
- phone_encrypted nullable
- created_at
- updated_at
- deleted_at

### user_roles
- user_id
- role
- created_at
PK `(user_id, role)`

### parent_profiles
- id
- user_id unique
- display_name
- city_code
- timezone
- created_at
- updated_at

### child_profiles
- id
- guardian_user_id
- nickname
- birth_year nullable
- grade_code
- school_name nullable/private
- learning_goals
- data_processing_consent_status
- created_at
- updated_at
- deleted_at

Do not store child phone, exact home address or unnecessary identity data.

### provider_profiles
- id
- user_id
- provider_type
- public_name
- headline
- bio
- avatar_visibility
- avatar_asset_id nullable
- city_code nullable
- service_mode
- approval_status
- searchable boolean
- rating_avg numeric
- rating_count integer
- completed_order_count integer
- created_at
- updated_at

### provider_capabilities
- id
- provider_id
- capability_type
- status
- verification_level
- compliance_status
- created_at
- updated_at

### verification_cases
- id
- provider_id
- verification_type
- status
- submitted_at
- reviewed_at
- reviewer_id
- decision_reason
- evidence_ref
- created_at
- updated_at

### verification_documents
- id
- case_id
- document_type
- storage_key
- file_hash
- encrypted_metadata
- expires_at nullable
- created_at

### services
- id
- provider_id
- domain (`TUTORING|CAREER`)
- title
- description
- duration_minutes
- price_minor
- currency
- delivery_mode
- status
- cancellation_policy_id
- created_at
- updated_at

### taxonomy_terms
- id
- type (`SUBJECT|GRADE|SKILL|CITY`)
- code
- name
- parent_id nullable
- active

### service_terms
- service_id
- term_id
PK `(service_id, term_id)`

### availability_slots
- id
- provider_id
- start_at
- end_at
- recurrence_rule nullable
- status

### orders
- id
- order_no unique
- buyer_user_id
- provider_id
- service_id
- child_id nullable
- domain
- status
- amount_minor
- platform_fee_minor
- provider_amount_minor
- currency
- scheduled_start nullable
- scheduled_end nullable
- price_snapshot JSONB
- policy_snapshot JSONB
- created_at
- updated_at

### payments
- id
- order_id
- provider
- provider_transaction_id unique nullable
- status
- amount_minor
- prepay_reference nullable
- paid_at nullable
- raw_callback_ref nullable
- created_at
- updated_at

### refunds
- id
- order_id
- payment_id
- amount_minor
- reason
- status
- provider_ref nullable
- created_at
- updated_at

### reviews
- id
- order_id
- reviewer_user_id
- reviewee_user_id
- rating
- content
- status
- created_at
- updated_at
Unique `(order_id, reviewer_user_id, reviewee_user_id)`.

### conversations
- id
- domain
- order_id nullable
- status
- provider_conversation_id nullable
- created_at
- updated_at

### conversation_members
- conversation_id
- user_id
- role
PK `(conversation_id, user_id)`

### message_refs
- id
- conversation_id
- external_message_id
- sender_user_id
- message_type
- moderation_status
- created_at

Do not persist full message content unless required by the selected IM/compliance design. If persisted, define retention and access controls first.

### reports
- id
- reporter_user_id
- target_type
- target_id
- reason_code
- description
- status
- moderator_id nullable
- resolution nullable
- created_at
- updated_at

### blocks
- blocker_user_id
- blocked_user_id
- created_at
PK `(blocker_user_id, blocked_user_id)`

### audit_logs
- id
- actor_user_id nullable
- actor_type
- action
- resource_type
- resource_id
- before_json
- after_json
- ip_hash nullable
- request_id
- created_at

### consents
- id
- user_id
- consent_type
- policy_version
- granted
- granted_at
- revoked_at nullable
- evidence_ref

### platform_rules
- id
- rule_type
- version
- status
- content_ref
- effective_at
- published_at
- created_at

### feature_flags
- key PK
- enabled
- config_json
- updated_at

## Indexes

Required:
- provider_profiles(searchable, approval_status, city_code)
- provider_capabilities(provider_id, capability_type, status)
- services(provider_id, status)
- service_terms(term_id, service_id)
- orders(buyer_user_id, created_at desc)
- orders(provider_id, created_at desc)
- orders(status, scheduled_start)
- payments(order_id)
- reviews(reviewee_user_id, created_at desc)
- reports(status, created_at)
- audit_logs(resource_type, resource_id, created_at desc)

## Data retention

Retention periods must be configurable by policy and legal advice.
Never implement arbitrary deletion of financial/audit records merely to satisfy UI cleanup.
Private identity documents should have a defined lifecycle and access audit.
