# Privacy and Minors

This is an engineering specification, not legal advice. Before production launch, obtain jurisdiction-specific legal/privacy review.

## Principles

- purpose limitation
- data minimization
- least privilege
- explicit consent records
- retention/deletion policy
- auditability
- security by default

China-specific baseline:
The Personal Information Protection Law treats personal information of children under 14 as sensitive personal information and requires parental/guardian consent for processing such information. The platform therefore treats child profiles as a protected data domain and must implement guardian consent before creating/using a child profile for service matching.

Reference:
https://sdca.miit.gov.cn/zwgk/fgbz/art/2026/art_3e2ad39014b743d58bab7a6815640aee.html

## Child profile rules

- Child profile is owned by guardian account.
- No public child profile.
- No child phone number.
- No exact home address.
- No identity document unless a separately approved necessity exists.
- Tutor sees only information necessary for service delivery.
- Child nickname may be pseudonymous.
- Guardian controls deletion/update requests subject to legally required retention.

## Consent model

Consent types:
- `TERMS`
- `PRIVACY`
- `SENSITIVE_DATA`
- `MINOR_GUARDIAN`
- `MARKETING`
- `IM_POLICY`

Store:
- policy version
- timestamp
- actor
- scope
- granted/revoked
- evidence reference

Do not use "continued use" as a substitute for a required explicit consent.

## Verification documents

- private storage
- encrypted metadata
- signed URLs
- short-lived access URLs
- access audit
- retention policy
- no public CDN URL

## Data access

API response DTOs must be allowlists, not ORM entity serialization.

## Export/deletion

Implement service layer for:
- access request
- correction request
- deletion request
- consent withdrawal

Do not automatically delete financial/audit records where retention is legally required.

## Platform rules

The 2026 Network Transaction Platform Rules Supervision and Administration Measures require platform rules to be public, clear, versioned and to provide complaint/appeal mechanisms; material rule changes have advance publication requirements. Product engineering must therefore support versioned platform rules rather than hard-coding commercial policies.

Reference:
https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2026/art_85b474fc5a08494bb60ca6a280b98d7d.html

## Teacher compliance

Teacher-provider eligibility must be reviewed for the actual jurisdiction, employment relationship and service model. The product must not encode an assumption that every employed school teacher may provide paid tutoring through the platform.

Implementation:
- configurable teacher capability;
- manual compliance review;
- restricted states;
- audit reason;
- location/service-type restrictions if applicable.
