import { Inject, Injectable } from '@nestjs/common';

import { CONSENT_REPOSITORY } from '../../identity/domain/consent.repository';
import type { ConsentRepository } from '../../identity/domain/consent.repository';
import type { ChildProfile, UpdateChildProfileInput } from '../domain/child-profile.model';
import { CHILD_PROFILE_REPOSITORY } from '../domain/child-profile.repository';
import type { ChildProfileRepository } from '../domain/child-profile.repository';
import { childAccessDenied, consentRequired, profileNotFound } from '../domain/profile.errors';
import { ConsentService } from './consent.service';

export interface CreateChildInput {
  nickname: string;
  birthYear?: number | null;
  gradeCode?: string | null;
  schoolName?: string | null;
  learningGoals?: string | null;
  /**
   * Policy version the guardian explicitly consents to, captured together with
   * the child profile (acceptance test AT-020).
   */
  consentPolicyVersion?: string;
}

/**
 * Child profiles (`specs/05-api-spec.md` §Profile,
 * `specs/10-privacy-and-minors.md` §Child profile rules).
 *
 * Invariants:
 * - a child profile is reachable only by its guardian (`CHILD_ACCESS_DENIED`);
 * - creating/updating one requires an active `MINOR_GUARDIAN` consent
 *   (`CONSENT_REQUIRED`);
 * - deletion is a soft delete so order history keeps resolving
 *   (`specs/10-privacy-and-minors.md` §Export/deletion).
 */
@Injectable()
export class ChildProfileService {
  constructor(
    @Inject(CHILD_PROFILE_REPOSITORY) private readonly children: ChildProfileRepository,
    @Inject(CONSENT_REPOSITORY) private readonly consents: ConsentRepository,
    @Inject(ConsentService) private readonly consentService: ConsentService,
  ) {}

  async create(guardianUserId: string, input: CreateChildInput, evidenceRef?: string | null) {
    await this.requireGuardianConsent(guardianUserId, input.consentPolicyVersion, evidenceRef);

    return this.children.create({
      guardianUserId,
      nickname: input.nickname,
      birthYear: input.birthYear ?? null,
      gradeCode: input.gradeCode ?? null,
      schoolName: input.schoolName ?? null,
      learningGoals: input.learningGoals ?? null,
      dataProcessingConsentStatus: 'GRANTED',
    });
  }

  async list(guardianUserId: string): Promise<ChildProfile[]> {
    return this.children.listByGuardian(guardianUserId);
  }

  async get(guardianUserId: string, childId: string): Promise<ChildProfile> {
    const child = await this.children.findById(childId);
    if (!child || child.deletedAt) {
      throw profileNotFound('Child profile not found.');
    }
    this.assertGuardian(child, guardianUserId);
    return child;
  }

  async update(
    guardianUserId: string,
    childId: string,
    input: UpdateChildProfileInput,
  ): Promise<ChildProfile> {
    const child = await this.get(guardianUserId, childId);
    // Updating child data is processing child data: consent must still be active.
    await this.requireGuardianConsent(guardianUserId);

    return this.children.update(child.id, {
      ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
      ...(input.birthYear === undefined ? {} : { birthYear: input.birthYear }),
      ...(input.gradeCode === undefined ? {} : { gradeCode: input.gradeCode }),
      ...(input.schoolName === undefined ? {} : { schoolName: input.schoolName }),
      ...(input.learningGoals === undefined ? {} : { learningGoals: input.learningGoals }),
    });
  }

  /**
   * Soft delete. Deletion stays available after consent withdrawal: the guardian
   * controls deletion requests (`specs/10-privacy-and-minors.md`).
   */
  async remove(guardianUserId: string, childId: string): Promise<string> {
    const child = await this.get(guardianUserId, childId);
    await this.children.softDelete(child.id);
    return child.id;
  }

  private assertGuardian(child: ChildProfile, guardianUserId: string): void {
    if (child.guardianUserId !== guardianUserId) {
      throw childAccessDenied();
    }
  }

  /**
   * Require an active `MINOR_GUARDIAN` consent, capturing it first when the
   * client supplies the policy version it agrees to.
   */
  private async requireGuardianConsent(
    guardianUserId: string,
    consentPolicyVersion?: string,
    evidenceRef?: string | null,
  ): Promise<void> {
    if (consentPolicyVersion) {
      await this.consentService.grant(
        guardianUserId,
        { consentType: 'MINOR_GUARDIAN', policyVersion: consentPolicyVersion },
        evidenceRef ?? null,
      );
      return;
    }

    const active = await this.consents.findActive(guardianUserId, 'MINOR_GUARDIAN');
    if (!active) {
      throw consentRequired();
    }
  }
}
