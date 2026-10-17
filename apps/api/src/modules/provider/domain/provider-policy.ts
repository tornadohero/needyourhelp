import type { ApprovalStatus, ProviderProfile } from './provider-profile.model';

/**
 * Provider application state machine and publication gates.
 *
 * `specs/06-verification-state-machine.md` §Provider application:
 * `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED`, with suspension
 * orthogonal (`APPROVED -> SUSPENDED -> APPROVED`) and resubmission after a
 * rejection. Transitions are explicit commands; a client never sets a status.
 */
export const PROVIDER_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUSPENDED'],
  REJECTED: ['SUBMITTED'],
  SUSPENDED: ['APPROVED'],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return PROVIDER_TRANSITIONS[from].includes(to);
}

/** The provider may edit the application while it is not under review. */
export function isEditable(status: ApprovalStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

/** Submission, including resubmission after a rejection. */
export function canSubmit(status: ApprovalStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

export function isApproved(status: ApprovalStatus): boolean {
  return status === 'APPROVED';
}

/**
 * Publication gate (`specs/01-business-rules.md`: "Provider cannot publish
 * before approval").
 *
 * Approval is necessary but not sufficient: the account must also be active.
 * This is the single check T009 (service publish) must call.
 */
export function canPublish(profile: ProviderProfile, accountActive: boolean): boolean {
  return accountActive && isApproved(profile.approvalStatus);
}

export interface ProviderReadinessGatesInput {
  accountActive: boolean;
  approvalStatus: ApprovalStatus;
  /** Verification is a separate aggregate: owned by T006. */
  verificationSatisfied: boolean;
  /** Published services are owned by T009. */
  hasPublishedService: boolean;
}

/**
 * Discovery gate (`provider_profiles.searchable`).
 *
 * A provider is discoverable only when the account is active, the application is
 * approved, the required verification passed and at least one service is
 * published (`specs/01-business-rules.md` §Provider approval).
 */
export function isDiscoverable(gates: ProviderReadinessGatesInput): boolean {
  return (
    gates.accountActive &&
    isApproved(gates.approvalStatus) &&
    gates.verificationSatisfied &&
    gates.hasPublishedService
  );
}
