import type { ConsentListResponse, ConsentResponse, ConsentTypeName } from '@mentor/api-contracts';

/**
 * Consents (T029).
 *
 * `specs/10-privacy-and-minors.md`: consent is explicit, recorded with the policy
 * version, and **withdrawable**. A revoked row stays in the history with
 * `granted: true` and a `revokedAt`, so "is it active" is `granted && !revokedAt`
 * — never `granted` alone.
 */

const CONSENT_LABELS: Record<ConsentTypeName, string> = {
  TERMS: '服务条款',
  PRIVACY: '隐私政策',
  SENSITIVE_DATA: '敏感信息处理',
  MINOR_GUARDIAN: '未成年人监护人同意',
  MARKETING: '营销信息',
  IM_POLICY: '沟通规范',
};

export interface ConsentView {
  type: ConsentTypeName;
  label: string;
  active: boolean;
  policyVersion: string;
  /** ISO date of the grant, formatted for display. */
  grantedAt: string;
  revokedAt: string | null;
}

export function consentLabel(type: ConsentTypeName): string {
  return CONSENT_LABELS[type] ?? type;
}

/** A consent is active while it is granted and has not been withdrawn. */
export function isActive(consent: ConsentResponse): boolean {
  return consent.granted && consent.revokedAt === null;
}

export function describeConsent(consent: ConsentResponse): ConsentView {
  return {
    type: consent.consentType,
    label: consentLabel(consent.consentType),
    active: isActive(consent),
    policyVersion: consent.policyVersion,
    grantedAt: consent.grantedAt,
    revokedAt: consent.revokedAt,
  };
}

/** Newest first, so a withdrawal is visible next to what it withdrew. */
export function describeConsents(list: ConsentListResponse): ConsentView[] {
  return [...list.consents]
    .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt))
    .map(describeConsent);
}
