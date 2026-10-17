/**
 * Domain view of the provider aggregate
 * (`specs/04-database-spec.md` §provider_profiles / §provider_capabilities,
 * `specs/02-domain-model.md` §Provider aggregate).
 *
 * Verification is a separate aggregate (`verification_cases`), so nothing here
 * decides identity or education outcomes.
 */

export type ProviderType = 'TUTORING' | 'CAREER';

/** `specs/01-business-rules.md` §Account and roles. */
export type CapabilityType =
  'STUDENT_TUTOR' | 'GRADUATE_TUTOR' | 'PHD_TUTOR' | 'TEACHER' | 'CAREER_MENTOR';

export const CAPABILITY_TYPES: readonly CapabilityType[] = [
  'STUDENT_TUTOR',
  'GRADUATE_TUTOR',
  'PHD_TUTOR',
  'TEACHER',
  'CAREER_MENTOR',
];

/** `specs/06-verification-state-machine.md` §Provider application. */
export type ApprovalStatus =
  'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type AvatarVisibility = 'PUBLIC' | 'PRIVATE';
export type DeliveryMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';
export type VerificationLevel = 'NONE' | 'IDENTITY' | 'EDUCATION' | 'FULL';
export type ComplianceStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'RESTRICTED'
  | 'REJECTED'
  | 'SUSPENDED';

const TUTORING_CAPABILITIES: readonly CapabilityType[] = [
  'STUDENT_TUTOR',
  'GRADUATE_TUTOR',
  'PHD_TUTOR',
  'TEACHER',
];

const CAREER_CAPABILITIES: readonly CapabilityType[] = ['CAREER_MENTOR'];

/**
 * Capabilities allowed for a provider type.
 *
 * A tutoring provider may not claim `CAREER_MENTOR` and vice versa: the career
 * marketplace is a separate, flagged domain (`AGENTS.md` §7).
 */
export function capabilitiesForProviderType(providerType: ProviderType): readonly CapabilityType[] {
  return providerType === 'CAREER' ? CAREER_CAPABILITIES : TUTORING_CAPABILITIES;
}

export function isCapabilityAllowedFor(
  providerType: ProviderType,
  capabilityType: CapabilityType,
): boolean {
  return capabilitiesForProviderType(providerType).includes(capabilityType);
}

export interface ProviderProfile {
  id: string;
  userId: string;
  providerType: ProviderType;
  publicName: string;
  headline: string | null;
  bio: string | null;
  avatarVisibility: AvatarVisibility;
  avatarAssetId: string | null;
  cityCode: string | null;
  serviceMode: DeliveryMode;
  approvalStatus: ApprovalStatus;
  /**
   * Discovery gate. Server-owned: it is recomputed from the approval and
   * readiness gates and is never accepted from a client
   * (`specs/01-business-rules.md` §Provider approval).
   */
  searchable: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  completedOrderCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProviderProfileInput {
  userId: string;
  providerType: ProviderType;
  publicName: string;
  headline?: string | null;
  bio?: string | null;
  avatarVisibility?: AvatarVisibility;
  cityCode?: string | null;
  serviceMode?: DeliveryMode;
}

/** Self-service edits. `approvalStatus` and `searchable` are absent on purpose. */
export interface UpdateProviderProfileInput {
  publicName?: string;
  headline?: string | null;
  bio?: string | null;
  avatarVisibility?: AvatarVisibility;
  cityCode?: string | null;
  serviceMode?: DeliveryMode;
}

export interface ProviderCapability {
  id: string;
  providerId: string;
  capabilityType: CapabilityType;
  status: ApprovalStatus;
  verificationLevel: VerificationLevel;
  complianceStatus: ComplianceStatus;
  /**
   * Scope of a `RESTRICTED` compliance decision (T007).
   *
   * Stored as opaque JSON here: the shape is owned by the compliance context,
   * which validates it before it is written (`specs/06` §Teacher compliance).
   */
  restrictionJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCapabilityInput {
  providerId: string;
  capabilityType: CapabilityType;
  status?: ApprovalStatus;
  verificationLevel?: VerificationLevel;
  complianceStatus?: ComplianceStatus;
  restrictionJson?: Record<string, unknown> | null;
}

export interface UpdateCapabilityInput {
  status?: ApprovalStatus;
  verificationLevel?: VerificationLevel;
  complianceStatus?: ComplianceStatus;
  restrictionJson?: Record<string, unknown> | null;
}

/**
 * Initial compliance state of a new capability.
 *
 * `TEACHER` requires a compliance review, so it starts `PENDING`
 * (`specs/01-business-rules.md` §Teacher provider). Transitions are owned by
 * T007; every other capability starts as `NOT_REQUIRED`.
 */
export function initialComplianceStatus(capabilityType: CapabilityType): ComplianceStatus {
  return capabilityType === 'TEACHER' ? 'PENDING' : 'NOT_REQUIRED';
}
