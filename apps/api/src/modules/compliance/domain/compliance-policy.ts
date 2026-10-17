import type {
  CapabilityType,
  ComplianceStatus,
  ProviderCapability,
} from '../../provider/domain/provider-profile.model';
import { parseRestriction, restrictionPermits } from './compliance-restriction';
import type { ServiceComplianceContext } from './compliance-restriction';

/**
 * Teacher compliance state machine
 * (`specs/06-verification-state-machine.md` §Teacher compliance,
 * `specs/01-business-rules.md` §Teacher provider).
 *
 * ```text
 * NOT_REQUIRED  (terminal: the capability needs no compliance review)
 * PENDING -> UNDER_REVIEW -> APPROVED | RESTRICTED | REJECTED
 * APPROVED -> RESTRICTED | SUSPENDED
 * RESTRICTED -> APPROVED | SUSPENDED | REJECTED
 * REJECTED -> PENDING            (the provider may re-enter review)
 * SUSPENDED -> APPROVED | RESTRICTED | REJECTED
 * ```
 *
 * Rules:
 * - `identity=APPROVED` is not sufficient;
 * - `education=APPROVED` is not sufficient;
 * - the capability is orderable only when the compliance state permits the
 *   specific service.
 *
 * Transitions are explicit commands; a client never sets a status.
 */
export const COMPLIANCE_TRANSITIONS: Record<ComplianceStatus, readonly ComplianceStatus[]> = {
  NOT_REQUIRED: [],
  PENDING: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESTRICTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'RESTRICTED'],
  APPROVED: ['RESTRICTED', 'SUSPENDED'],
  RESTRICTED: ['APPROVED', 'SUSPENDED', 'REJECTED'],
  REJECTED: ['PENDING'],
  SUSPENDED: ['APPROVED', 'RESTRICTED', 'REJECTED'],
};

export function canTransitionCompliance(from: ComplianceStatus, to: ComplianceStatus): boolean {
  return COMPLIANCE_TRANSITIONS[from].includes(to);
}

/**
 * Compliance review applies to the teacher capability only.
 *
 * `specs/01-business-rules.md`: "Teacher capability requires compliance
 * review". Every other capability starts and stays `NOT_REQUIRED`.
 */
export function requiresCompliance(capabilityType: CapabilityType): boolean {
  return capabilityType === 'TEACHER';
}

/** States a reviewer still has to act on. */
export const COMPLIANCE_REVIEW_STATUSES: readonly ComplianceStatus[] = ['PENDING', 'UNDER_REVIEW'];

/**
 * Orderability gate — the single check T013 (orders) must call for a teacher
 * capability.
 *
 * `APPROVED` (and `NOT_REQUIRED` for non-teacher capabilities) permits every
 * service; `RESTRICTED` permits only the services inside its granted scope.
 * `PENDING`, `UNDER_REVIEW`, `REJECTED` and `SUSPENDED` permit nothing: a
 * teacher with pending compliance cannot be ordered.
 */
export function isOrderable(
  capability: ProviderCapability,
  context: ServiceComplianceContext = {},
): boolean {
  if (!requiresCompliance(capability.capabilityType)) {
    return true;
  }

  if (capability.complianceStatus === 'APPROVED') {
    return true;
  }

  if (capability.complianceStatus === 'RESTRICTED') {
    return restrictionPermits(parseRestriction(capability.restrictionJson), context);
  }

  return false;
}
