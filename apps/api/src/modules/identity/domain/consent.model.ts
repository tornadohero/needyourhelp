/**
 * Domain view of `consents` (`specs/04-database-spec.md` §consents,
 * `specs/10-privacy-and-minors.md` §Consent model).
 *
 * Consent is append-only: a new grant appends a row instead of overwriting
 * history, and a withdrawal timestamps the row that was active. This keeps the
 * policy version, the timestamp, the actor and the evidence auditable.
 */
export type ConsentType =
  'TERMS' | 'PRIVACY' | 'SENSITIVE_DATA' | 'MINOR_GUARDIAN' | 'MARKETING' | 'IM_POLICY';

export const CONSENT_TYPES: readonly ConsentType[] = [
  'TERMS',
  'PRIVACY',
  'SENSITIVE_DATA',
  'MINOR_GUARDIAN',
  'MARKETING',
  'IM_POLICY',
];

export interface Consent {
  id: string;
  userId: string;
  consentType: ConsentType;
  /** Version of the policy the user consented to. */
  policyVersion: string;
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
  /** Reference to the evidence of the consent action (e.g. request id). */
  evidenceRef: string | null;
}

export interface GrantConsentInput {
  userId: string;
  consentType: ConsentType;
  policyVersion: string;
  evidenceRef?: string | null;
}

/** A row is active when it was granted and has not been withdrawn. */
export function isActiveConsent(consent: Consent): boolean {
  return consent.granted && consent.revokedAt === null;
}
