/**
 * Profile, child and consent contract (T004).
 *
 * Source of truth: `specs/05-api-spec.md` §Profile, `specs/04-database-spec.md`
 * (§parent_profiles / §child_profiles / §consents) and
 * `specs/10-privacy-and-minors.md` (§Child profile rules, §Consent model).
 *
 * Every payload here is an allowlist. ORM entities are never serialized
 * (`AGENTS.md` §10, `specs/10-privacy-and-minors.md` §Data access).
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Parent/guardian profile (`parent_profiles`). */
export interface ParentProfileResponse {
  id: string;
  displayName: string;
  cityCode: string | null;
  timezone: string;
}

/**
 * `GET|PUT /me/profile`.
 *
 * `parentProfile` is `null` until the account sets guardian details; there is no
 * public profile payload in this task.
 */
export interface ProfileResponse {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  parentProfile: ParentProfileResponse | null;
}

// ---------------------------------------------------------------------------
// Child profiles
// ---------------------------------------------------------------------------

/**
 * `child_profiles.data_processing_consent_status`.
 *
 * Guardian consent is required before child data may be processed
 * (`specs/10-privacy-and-minors.md`).
 */
export type ChildConsentStatus = 'PENDING' | 'GRANTED' | 'REVOKED';

/**
 * A child profile as returned to its guardian.
 *
 * This is the only payload that may carry child detail, and it is scoped to the
 * guardian (`specs/07-permission-spec.md` §Resource permissions: "Parent can
 * CRUD own children"). `schoolName` is private and must never appear in a
 * public/non-guardian projection.
 */
export interface ChildProfileResponse {
  id: string;
  nickname: string;
  birthYear: number | null;
  gradeCode: string | null;
  schoolName: string | null;
  learningGoals: string | null;
  consentStatus: ChildConsentStatus;
  createdAt: string;
}

export interface ChildListResponse {
  children: ChildProfileResponse[];
}

/** Result of `DELETE /me/children/:id`: a soft delete, never a hard delete. */
export interface ChildDeletionResponse {
  id: string;
  deleted: true;
}

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------

/** `consents.consent_type` — `specs/10-privacy-and-minors.md` §Consent model. */
export const CONSENT_TYPES = [
  'TERMS',
  'PRIVACY',
  'SENSITIVE_DATA',
  'MINOR_GUARDIAN',
  'MARKETING',
  'IM_POLICY',
] as const;

export type ConsentTypeName = (typeof CONSENT_TYPES)[number];

/**
 * A consent record (append-only history; revoked rows keep `granted: true`
 * together with a `revokedAt` timestamp).
 */
export interface ConsentResponse {
  id: string;
  consentType: ConsentTypeName;
  policyVersion: string;
  granted: boolean;
  grantedAt: string;
  revokedAt: string | null;
}

export interface ConsentListResponse {
  consents: ConsentResponse[];
}
