/**
 * Domain view of `audit_logs` (`specs/04-database-spec.md` §audit_logs).
 *
 * Audit rows are append-only and carry a before/after snapshot so an admin
 * decision can be reconstructed without reading live state.
 */
export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  ipHash: string | null;
  requestId: string;
  createdAt: Date;
}

/** Actions recorded by the platform. Kept in one place so reports stay stable. */
export const AUDIT_ACTIONS = {
  providerApproved: 'PROVIDER_APPROVED',
  providerRejected: 'PROVIDER_REJECTED',
  /** Suspension is orthogonal to approval, and audited like any decision (T019). */
  providerSuspended: 'PROVIDER_SUSPENDED',
  providerRestored: 'PROVIDER_RESTORED',
  roleGranted: 'ROLE_GRANTED',
  /** A role is power: revoking one is audited too (T019). */
  roleRevoked: 'ROLE_REVOKED',
  /** Production switches and published rules (`specs/12` §Audit). */
  featureFlagChanged: 'FEATURE_FLAG_CHANGED',
  platformRuleCreated: 'PLATFORM_RULE_CREATED',
  platformRulePublished: 'PLATFORM_RULE_PUBLISHED',
  verificationApproved: 'VERIFICATION_APPROVED',
  verificationRejected: 'VERIFICATION_REJECTED',
  /** Privileged read of a private document (`specs/12-admin-spec.md`). */
  verificationDocumentAccessed: 'VERIFICATION_DOCUMENT_ACCESSED',
  complianceReviewStarted: 'COMPLIANCE_REVIEW_STARTED',
  complianceApproved: 'COMPLIANCE_APPROVED',
  complianceRestricted: 'COMPLIANCE_RESTRICTED',
  complianceRejected: 'COMPLIANCE_REJECTED',
  complianceSuspended: 'COMPLIANCE_SUSPENDED',
  /** Money moving back to the customer (`specs/12-admin-spec.md`: audit every refund). */
  refundInitiated: 'REFUND_INITIATED',
  /** Moderation: the decision, an investigation step and the appeal (T018). */
  moderationResolved: 'MODERATION_RESOLVED',
  moderationCaseTransitioned: 'MODERATION_CASE_TRANSITIONED',
  moderationAppealFiled: 'MODERATION_APPEAL_FILED',
  moderationAppealFinalized: 'MODERATION_APPEAL_FINALIZED',
  /** Taxonomy (platform configuration) mutations (`specs/05-api-spec.md`). */
  taxonomyCreated: 'TAXONOMY_CREATED',
  taxonomyUpdated: 'TAXONOMY_UPDATED',
  taxonomyArchived: 'TAXONOMY_ARCHIVED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
