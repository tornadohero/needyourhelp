import type { Consent, ConsentType, GrantConsentInput } from './consent.model';

/** Dependency-injection token for {@link ConsentRepository}. */
export const CONSENT_REPOSITORY = 'CONSENT_REPOSITORY';

/**
 * Persistence port for consent records.
 *
 * Consent belongs to the Identity context (`specs/02-domain-model.md`), but the
 * port is consumed by the profile/child use cases that need guardian consent
 * (`specs/10-privacy-and-minors.md`).
 */
export interface ConsentRepository {
  /** Most recent active grant for a user + type, or `null`. */
  findActive(userId: string, consentType: ConsentType): Promise<Consent | null>;

  /** Full history for a user, newest grant first. */
  listByUser(userId: string): Promise<Consent[]>;

  /** Append a grant. Never overwrites history. */
  grant(input: GrantConsentInput): Promise<Consent>;

  /**
   * Withdraw the active grant (sets `revoked_at`).
   *
   * Returns `null` when there is nothing to withdraw.
   */
  revokeActive(userId: string, consentType: ConsentType): Promise<Consent | null>;
}
