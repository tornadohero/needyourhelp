import { Inject, Injectable } from '@nestjs/common';

import type { ConsentType } from '../../identity/domain/consent.model';
import { CONSENT_REPOSITORY } from '../../identity/domain/consent.repository';
import type { ConsentRepository } from '../../identity/domain/consent.repository';
import type { ChildProfileRepository } from '../domain/child-profile.repository';
import { CHILD_PROFILE_REPOSITORY } from '../domain/child-profile.repository';
import { profileNotFound } from '../domain/profile.errors';

/**
 * Explicit consent records (`specs/10-privacy-and-minors.md` §Consent model).
 *
 * Every grant stores the policy version, the timestamp, the actor (the account
 * the request is authenticated as) and an evidence reference. "Continued use" is
 * never treated as consent, and withdrawal is explicit.
 */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
    @Inject(CHILD_PROFILE_REPOSITORY) private readonly children: ChildProfileRepository,
  ) {}

  /** Consent history for the account, newest first. */
  async list(userId: string) {
    return this.consents.listByUser(userId);
  }

  /** Record an explicit grant. */
  async grant(
    userId: string,
    input: { consentType: ConsentType; policyVersion: string },
    evidenceRef?: string | null,
  ) {
    const consent = await this.consents.grant({
      userId,
      consentType: input.consentType,
      policyVersion: input.policyVersion,
      evidenceRef: evidenceRef ?? null,
    });

    // Child processing is only allowed while guardian consent is active, so the
    // derived status on the child rows follows the consent record.
    if (input.consentType === 'MINOR_GUARDIAN') {
      await this.children.setConsentStatusForGuardian(userId, 'GRANTED');
    }

    return consent;
  }

  /**
   * Withdraw an active consent (`specs/10-privacy-and-minors.md`
   * §Export/deletion — consent withdrawal).
   */
  async revoke(userId: string, consentType: ConsentType) {
    const revoked = await this.consents.revokeActive(userId, consentType);
    if (!revoked) {
      throw profileNotFound('No active consent to withdraw.');
    }

    if (consentType === 'MINOR_GUARDIAN') {
      await this.children.setConsentStatusForGuardian(userId, 'REVOKED');
    }

    return revoked;
  }
}
