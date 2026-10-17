import type { VerificationStatus, VerificationType } from './verification-case.model';
import { REQUIRED_VERIFICATION_TYPES } from './verification-case.model';

/**
 * Verification state machine and review gates.
 *
 * `specs/06-verification-state-machine.md` §Identity verification:
 * `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> REJECTED -> RESUBMITTED`,
 * where "terminal only after admin policy" is read as: `APPROVED` is terminal
 * and `REJECTED` can be resubmitted. Transitions are explicit commands; a client
 * never sets a status.
 *
 * `SUBMITTED -> APPROVED|REJECTED` (without an explicit `UNDER_REVIEW` step) is
 * allowed for the same reason as in the provider application machine (T005):
 * `specs/05-api-spec.md` defines no "start review" command.
 */
export const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  RESUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  REJECTED: ['RESUBMITTED'],
  APPROVED: [],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFICATION_TRANSITIONS[from].includes(to);
}

/** Evidence may be attached while the case is not awaiting a decision. */
export function isEditable(status: VerificationStatus): boolean {
  return status === 'DRAFT' || status === 'RESUBMITTED';
}

/**
 * Submission target.
 *
 * A first submission moves `DRAFT -> SUBMITTED`; a resubmission after a
 * rejection moves `REJECTED -> RESUBMITTED` so the history is distinguishable.
 */
export function submissionTarget(status: VerificationStatus): 'SUBMITTED' | 'RESUBMITTED' | null {
  if (status === 'DRAFT') {
    return 'SUBMITTED';
  }
  if (status === 'REJECTED') {
    return 'RESUBMITTED';
  }
  return null;
}

/** An admin may decide a case that is awaiting review. */
export function isDecidable(status: VerificationStatus): boolean {
  return status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'RESUBMITTED';
}

export function isApproved(status: VerificationStatus): boolean {
  return status === 'APPROVED';
}

/** Whether every verification required for discoverability is approved. */
export function isVerificationSatisfied(approvedTypes: readonly VerificationType[]): boolean {
  return REQUIRED_VERIFICATION_TYPES.every((type) => approvedTypes.includes(type));
}
