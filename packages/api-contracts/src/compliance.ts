/**
 * Teacher compliance contract (T007).
 *
 * Source of truth: `specs/06-verification-state-machine.md` §Teacher compliance,
 * `specs/01-business-rules.md` §Teacher provider,
 * `specs/10-privacy-and-minors.md` §Teacher compliance and
 * `specs/12-admin-spec.md` §Provider review workflow.
 *
 * Compliance is a per-capability state, separate from provider approval and
 * from identity/education verification: a verified teacher is not a permitted
 * teacher.
 *
 * Every payload is an allowlist: ORM entities are never serialized
 * (`AGENTS.md` §10).
 */

import type { CapabilityTypeName, ComplianceStatusName } from './provider';

// ---------------------------------------------------------------------------
// Restriction
// ---------------------------------------------------------------------------

/**
 * Scope of a `RESTRICTED` compliance decision
 * (`specs/06-verification-state-machine.md`: "Restriction can be
 * category/time/location specific through `restriction_json`").
 *
 * Semantics are an allowlist: a present dimension must be matched by the
 * service; an absent dimension is not checked. The reviewer note is internal
 * and is never part of a response (`AGENTS.md` §9).
 */
export interface ComplianceRestrictionResponse {
  /** Category: taxonomy codes (subject/skill) the teacher may teach. */
  allowedSubjectCodes: string[] | null;
  /** Location: city codes where the service may be delivered. */
  allowedCityCodes: string[] | null;
  /** Time: last instant at which the restriction still permits the service. */
  allowedUntil: string | null;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * A capability in the compliance queue, and the result of every compliance
 * command.
 *
 * Admin-facing only: compliance decisions are internal review outcomes
 * (`specs/12-admin-spec.md`; `AGENTS.md` §9: never expose internal moderation
 * notes).
 */
export interface AdminComplianceItemResponse {
  capabilityId: string;
  providerId: string;
  providerName: string;
  capabilityType: CapabilityTypeName;
  complianceStatus: ComplianceStatusName;
  restriction: ComplianceRestrictionResponse | null;
  updatedAt: string;
}

export interface AdminComplianceQueueResponse {
  items: AdminComplianceItemResponse[];
}
