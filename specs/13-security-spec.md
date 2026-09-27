# Security Spec

## Threat model

Protect:
- accounts
- child information
- identity documents
- payment state
- provider reputation
- admin controls
- message abuse.

## Controls

### Authentication
- WeChat login.
- Short-lived access token.
- Rotating refresh token.
- Revoke on logout/security event.

### Authorization
- RBAC.
- Resource ownership.
- Field-level access.
- Server-side enforcement.

### API
- schema validation
- rate limiting
- CSRF considerations for web admin
- CORS allowlist
- secure headers
- request IDs
- input/output size limits.

### File upload
- signed upload URL
- whitelist MIME and extension
- max size
- generated object key
- malware scan where available
- no executable file types
- private bucket for verification docs.

### Secrets
Environment variables/secret manager only.

### Logging
Never log:
- access tokens
- refresh tokens
- ID numbers
- raw documents
- payment secrets
- full child profiles.

## Abuse prevention

- account rate limits
- message rate limits
- provider application rate limits
- payment attempt limits
- review frequency limits
- IP/device risk signals as optional future module.

## Security acceptance

Critical tests must cover:
- horizontal privilege escalation
- child profile leakage
- provider verification bypass
- order price tampering
- payment callback replay
- refund overrun
- admin endpoint access
- file URL leakage.
