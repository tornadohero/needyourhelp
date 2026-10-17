import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { FEATURE_FLAG_REPOSITORY } from '../../platform/domain/feature-flag.repository';
import type { FeatureFlagRepository } from '../../platform/domain/feature-flag.repository';
import { FEATURE_FLAGS } from '../../platform/infrastructure/prisma-feature-flag.repository';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../domain/provider-capability.repository';
import type { ProviderCapabilityRepository } from '../domain/provider-capability.repository';
import { initialComplianceStatus, isCapabilityAllowedFor } from '../domain/provider-profile.model';
import type {
  CapabilityType,
  ProviderCapability,
  ProviderProfile,
  ProviderType,
  UpdateProviderProfileInput,
} from '../domain/provider-profile.model';
import { PROVIDER_PROFILE_REPOSITORY } from '../domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../domain/provider-profile.repository';
import {
  providerForbidden,
  providerInvalidState,
  providerNotApproved,
  providerNotFound,
} from '../domain/provider.errors';
import { canPublish, canSubmit, isEditable, canTransition } from '../domain/provider-policy';
import { PROVIDER_READINESS_GATES } from '../domain/provider-readiness.gates';
import type { ProviderReadinessGates } from '../domain/provider-readiness.gates';

/** A provider profile together with its capabilities. */
export interface ProviderApplication {
  profile: ProviderProfile;
  capabilities: ProviderCapability[];
}

export interface CreateApplicationInput {
  providerType: ProviderType;
  publicName: string;
  headline?: string | null;
  bio?: string | null;
  avatarVisibility?: ProviderProfile['avatarVisibility'];
  cityCode?: string | null;
  serviceMode?: ProviderProfile['serviceMode'];
  capabilityTypes: CapabilityType[];
}

export interface UpdateApplicationInput extends UpdateProviderProfileInput {
  capabilityTypes?: CapabilityType[];
}

/**
 * Provider onboarding: application, self-service edits and submission
 * (`specs/05-api-spec.md` §Provider).
 *
 * The provider never decides its own status: submission and the admin decision
 * are separate commands (`specs/06-verification-state-machine.md`).
 */
@Injectable()
export class ProviderApplicationService {
  constructor(
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(PROVIDER_CAPABILITY_REPOSITORY)
    private readonly capabilities: ProviderCapabilityRepository,
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
    @Inject(PROVIDER_READINESS_GATES) private readonly gates: ProviderReadinessGates,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /**
   * The career marketplace is feature-flagged (`AGENTS.md` §7,
   * `specs/03-architecture-spec.md` §Feature flags): with the flag off there is
   * no career route, career provider or career service at all — not only a
   * hidden listing. Every career entry point calls this (T021).
   */
  async assertMarketplaceOpen(providerType: ProviderType): Promise<void> {
    if (providerType !== 'CAREER') {
      return;
    }
    if (!(await this.flags.isEnabled(FEATURE_FLAGS.careerMarketplace))) {
      throw providerForbidden('The career marketplace is not enabled.');
    }
  }

  /** `POST /providers/applications`. */
  async createApplication(
    userId: string,
    input: CreateApplicationInput,
  ): Promise<ProviderApplication> {
    await this.assertAccountCanOnboard(userId);

    await this.assertMarketplaceOpen(input.providerType);

    const existing = await this.profiles.findByUserAndType(userId, input.providerType);
    if (existing) {
      throw providerInvalidState('This account already has a provider application of this type.');
    }

    const capabilityTypes = this.assertCapabilityTypes(input.providerType, input.capabilityTypes);

    const profile = await this.profiles.create({
      userId,
      providerType: input.providerType,
      publicName: input.publicName,
      headline: input.headline ?? null,
      bio: input.bio ?? null,
      avatarVisibility: input.avatarVisibility ?? 'PRIVATE',
      cityCode: input.cityCode ?? null,
      serviceMode: input.serviceMode ?? 'ONLINE',
    });

    await this.analytics?.track({
      name: 'application_started',
      actorUserId: userId,
      providerId: profile.id,
      props: {},
    });

    const capabilities = await this.capabilities.createMany(
      capabilityTypes.map((capabilityType) => ({
        providerId: profile.id,
        capabilityType,
        status: 'DRAFT',
        verificationLevel: 'NONE',
        complianceStatus: initialComplianceStatus(capabilityType),
      })),
    );

    return { profile, capabilities };
  }

  /** `GET /providers/me`. */
  async getMyApplication(
    userId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<ProviderApplication> {
    const profile = await this.profiles.findByUserAndType(userId, providerType);
    if (!profile) {
      throw providerNotFound('No provider application for this account.');
    }
    return { profile, capabilities: await this.capabilities.listByProvider(profile.id) };
  }

  /** `PATCH /providers/me`: only while the application is editable. */
  async updateMyApplication(
    userId: string,
    input: UpdateApplicationInput,
    providerType: ProviderType = 'TUTORING',
  ): Promise<ProviderApplication> {
    const { profile } = await this.getMyApplication(userId, providerType);
    if (!isEditable(profile.approvalStatus)) {
      throw providerInvalidState(
        `A provider application in status ${profile.approvalStatus} cannot be edited.`,
      );
    }

    const updated = await this.profiles.update(profile.id, {
      ...(input.publicName === undefined ? {} : { publicName: input.publicName }),
      ...(input.headline === undefined ? {} : { headline: input.headline }),
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.avatarVisibility === undefined ? {} : { avatarVisibility: input.avatarVisibility }),
      ...(input.cityCode === undefined ? {} : { cityCode: input.cityCode }),
      ...(input.serviceMode === undefined ? {} : { serviceMode: input.serviceMode }),
    });

    let capabilities = await this.capabilities.listByProvider(profile.id);
    if (input.capabilityTypes !== undefined) {
      const capabilityTypes = this.assertCapabilityTypes(
        profile.providerType,
        input.capabilityTypes,
      );
      capabilities = await this.capabilities.replaceForProvider(
        profile.id,
        capabilityTypes.map((capabilityType) => ({
          providerId: profile.id,
          capabilityType,
          status: 'DRAFT',
          verificationLevel: 'NONE',
          complianceStatus: initialComplianceStatus(capabilityType),
        })),
      );
    }

    return { profile: updated, capabilities };
  }

  /** `POST /providers/me/submit`: DRAFT/REJECTED -> SUBMITTED. */
  async submitApplication(
    userId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<ProviderApplication> {
    await this.assertMarketplaceOpen(providerType);
    const { profile, capabilities } = await this.getMyApplication(userId, providerType);

    if (!canSubmit(profile.approvalStatus)) {
      throw providerInvalidState(
        `A provider application in status ${profile.approvalStatus} cannot be submitted.`,
      );
    }
    this.assertComplete(profile, capabilities);

    if (!canTransition(profile.approvalStatus, 'SUBMITTED')) {
      throw providerInvalidState(`Illegal transition ${profile.approvalStatus} -> SUBMITTED.`);
    }

    const submitted = await this.profiles.setApprovalStatus(profile.id, 'SUBMITTED');

    await this.analytics?.track({
      name: 'application_submitted',
      actorUserId: userId,
      providerId: submitted.id,
      props: {},
    });

    return { profile: submitted, capabilities };
  }

  /**
   * Publication gate for later tasks (T009 service publish, T010 discovery).
   *
   * Approval is required and is never inferable from the request.
   */
  async assertCanPublish(
    userId: string,
    providerType: ProviderType = 'TUTORING',
  ): Promise<ProviderApplication> {
    await this.assertMarketplaceOpen(providerType);
    const application = await this.getMyApplication(userId, providerType);
    const user = await this.users.findById(userId);

    if (!canPublish(application.profile, user?.status === 'ACTIVE' && !user?.deletedAt)) {
      throw providerNotApproved();
    }

    return application;
  }

  /** Recompute `searchable` from the approval and readiness gates. */
  async refreshSearchable(profile: ProviderProfile): Promise<ProviderProfile> {
    const user = await this.users.findById(profile.userId);
    const accountActive = user?.status === 'ACTIVE' && !user?.deletedAt;

    // A marketplace that is switched off has no discoverable provider, even one
    // that was approved while it was on.
    const marketplaceOpen =
      profile.providerType !== 'CAREER' ||
      (await this.flags.isEnabled(FEATURE_FLAGS.careerMarketplace));

    const searchable =
      marketplaceOpen &&
      accountActive &&
      profile.approvalStatus === 'APPROVED' &&
      (await this.gates.verificationSatisfied(profile.id)) &&
      (await this.gates.hasPublishedService(profile.id));

    if (searchable === profile.searchable) {
      return profile;
    }
    return this.profiles.setSearchable(profile.id, searchable);
  }

  private async assertAccountCanOnboard(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) {
      throw providerNotFound('Account not found.');
    }
    if (user.status !== 'ACTIVE') {
      throw providerInvalidState('A suspended account cannot apply to become a provider.');
    }
  }

  /** Rejects empty sets, duplicates and capabilities of the wrong domain. */
  private assertCapabilityTypes(
    providerType: ProviderType,
    capabilityTypes: CapabilityType[],
  ): CapabilityType[] {
    if (capabilityTypes.length === 0) {
      throw providerInvalidState('At least one capability is required.');
    }

    const unique = [...new Set(capabilityTypes)];
    for (const capabilityType of unique) {
      if (!isCapabilityAllowedFor(providerType, capabilityType)) {
        throw providerInvalidState(
          `Capability ${capabilityType} is not valid for a ${providerType} provider.`,
        );
      }
    }
    return unique;
  }

  /** A submitted application must be reviewable: name and one capability. */
  private assertComplete(profile: ProviderProfile, capabilities: ProviderCapability[]): void {
    if (profile.publicName.trim().length === 0) {
      throw providerInvalidState('A public name is required before submitting.');
    }
    if (capabilities.length === 0) {
      throw providerInvalidState('At least one capability is required before submitting.');
    }
  }
}
