/**
 * Provider onboarding contract (T005).
 *
 * Source of truth: `specs/05-api-spec.md` §Provider, `specs/04-database-spec.md`
 * (§provider_profiles / §provider_capabilities),
 * `specs/06-verification-state-machine.md` §Provider application and
 * `specs/01-business-rules.md` §Provider approval.
 *
 * Every payload is an allowlist: ORM entities are never serialized
 * (`AGENTS.md` §10).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `provider_profiles.provider_type` — mirrors `services.domain`. */
export const PROVIDER_TYPES = ['TUTORING', 'CAREER'] as const;
export type ProviderTypeName = (typeof PROVIDER_TYPES)[number];

/**
 * Provider capability types — `specs/01-business-rules.md` §Account and roles.
 *
 * A person may hold several capabilities; each has its own status,
 * verification level and compliance state.
 */
export const CAPABILITY_TYPES = [
  'STUDENT_TUTOR',
  'GRADUATE_TUTOR',
  'PHD_TUTOR',
  'TEACHER',
  'CAREER_MENTOR',
] as const;
export type CapabilityTypeName = (typeof CAPABILITY_TYPES)[number];

/**
 * `provider_profiles.approval_status` / `provider_capabilities.status`.
 *
 * `specs/06-verification-state-machine.md` §Provider application plus the
 * orthogonal suspension (`APPROVED -> SUSPENDED -> APPROVED`).
 */
export const PROVIDER_APPROVAL_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type ProviderApprovalStatus = (typeof PROVIDER_APPROVAL_STATUSES)[number];

/** `provider_profiles.avatar_visibility` (`specs/07-permission-spec.md`). */
export const AVATAR_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type AvatarVisibilityName = (typeof AVATAR_VISIBILITIES)[number];

/** `provider_profiles.service_mode`. */
export const DELIVERY_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'] as const;
export type DeliveryModeName = (typeof DELIVERY_MODES)[number];

/** `provider_capabilities.verification_level`. */
export const VERIFICATION_LEVELS = ['NONE', 'IDENTITY', 'EDUCATION', 'FULL'] as const;
export type VerificationLevelName = (typeof VERIFICATION_LEVELS)[number];

/** `provider_capabilities.compliance_status` (`specs/06` §Teacher compliance). */
export const COMPLIANCE_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'RESTRICTED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type ComplianceStatusName = (typeof COMPLIANCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface ProviderCapabilityResponse {
  id: string;
  capabilityType: CapabilityTypeName;
  status: ProviderApprovalStatus;
  verificationLevel: VerificationLevelName;
  complianceStatus: ComplianceStatusName;
  createdAt: string;
}

/**
 * A provider profile.
 *
 * `searchable` is the discovery gate: it is server-owned and is only ever
 * computed from the approval and readiness gates, never accepted from a client
 * (`specs/01-business-rules.md` §Provider approval).
 */
export interface ProviderProfileResponse {
  id: string;
  userId: string;
  providerType: ProviderTypeName;
  publicName: string;
  headline: string | null;
  bio: string | null;
  avatarVisibility: AvatarVisibilityName;
  cityCode: string | null;
  serviceMode: DeliveryModeName;
  approvalStatus: ProviderApprovalStatus;
  searchable: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  completedOrderCount: number;
  capabilities: ProviderCapabilityResponse[];
  createdAt: string;
  updatedAt: string;
}
