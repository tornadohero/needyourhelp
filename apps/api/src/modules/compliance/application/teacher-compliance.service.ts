import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../../provider/domain/provider-capability.repository';
import type { ProviderCapabilityRepository } from '../../provider/domain/provider-capability.repository';
import type {
  CapabilityType,
  ComplianceStatus,
  ProviderCapability,
} from '../../provider/domain/provider-profile.model';
import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import {
  complianceInvalidState,
  complianceNotPermitted,
  complianceNotFound,
} from '../domain/compliance.errors';
import {
  COMPLIANCE_REVIEW_STATUSES,
  canTransitionCompliance,
  isOrderable,
  requiresCompliance,
} from '../domain/compliance-policy';
import { normalizeRestriction, parseRestriction } from '../domain/compliance-restriction';
import type {
  ComplianceRestriction,
  ServiceComplianceContext,
} from '../domain/compliance-restriction';

/** Context every compliance command carries (`specs/06` §Admin decisions). */
export interface ComplianceDecisionContext {
  actorUserId: string;
  reasonCode: string;
  notes?: string | null;
  requestId: string;
  ipHash?: string | null;
}

/** A capability together with the provider it belongs to, for the admin queue. */
export interface ComplianceQueueItem {
  capability: ProviderCapability;
  providerName: string;
}

/**
 * Teacher compliance (`specs/06-verification-state-machine.md` §Teacher
 * compliance, `specs/10-privacy-and-minors.md` §Teacher compliance).
 *
 * Compliance is a per-capability state, decided by an admin and never by the
 * provider: `identity=APPROVED` and `education=APPROVED` are each insufficient
 * (`specs/01-business-rules.md` §Teacher provider).
 *
 * The provider-facing outcome is the orderability gate: T013 (orders) calls
 * {@link assertOrderable} and must not infer permission from verification.
 */
@Injectable()
export class TeacherComplianceService {
  constructor(
    @Inject(PROVIDER_CAPABILITY_REPOSITORY)
    private readonly capabilities: ProviderCapabilityRepository,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  /** `GET /admin/compliance`: the review queue. */
  async listQueue(filter: {
    status?: ComplianceStatus[];
    limit?: number;
  }): Promise<ComplianceQueueItem[]> {
    const capabilities = await this.capabilities.listByComplianceStatus({
      statuses: filter.status ?? [...COMPLIANCE_REVIEW_STATUSES],
      // Only the teacher capability requires a compliance review.
      capabilityType: 'TEACHER',
      limit: filter.limit ?? 50,
    });

    const names = await this.providerNames(capabilities.map((capability) => capability.providerId));
    return capabilities.map((capability) => ({
      capability,
      providerName: names.get(capability.providerId) ?? '',
    }));
  }

  /** `POST /admin/compliance/:capabilityId/start-review`. */
  async startReview(
    capabilityId: string,
    context: ComplianceDecisionContext,
  ): Promise<ComplianceQueueItem> {
    return this.decide(
      capabilityId,
      'UNDER_REVIEW',
      context,
      AUDIT_ACTIONS.complianceReviewStarted,
      {
        restriction: null,
      },
    );
  }

  /** `POST /admin/compliance/:capabilityId/approve`: full permission. */
  async approve(
    capabilityId: string,
    context: ComplianceDecisionContext,
  ): Promise<ComplianceQueueItem> {
    return this.decide(capabilityId, 'APPROVED', context, AUDIT_ACTIONS.complianceApproved, {
      // An approval grants the whole capability: no restriction may survive.
      restriction: null,
    });
  }

  /** `POST /admin/compliance/:capabilityId/reject`. */
  async reject(
    capabilityId: string,
    context: ComplianceDecisionContext,
  ): Promise<ComplianceQueueItem> {
    return this.decide(capabilityId, 'REJECTED', context, AUDIT_ACTIONS.complianceRejected, {
      restriction: null,
    });
  }

  /** `POST /admin/compliance/:capabilityId/suspend`. */
  async suspend(
    capabilityId: string,
    context: ComplianceDecisionContext,
  ): Promise<ComplianceQueueItem> {
    return this.decide(capabilityId, 'SUSPENDED', context, AUDIT_ACTIONS.complianceSuspended, {
      restriction: null,
    });
  }

  /**
   * `POST /admin/compliance/:capabilityId/restrict`: permission limited to a
   * configurable scope (category / location / time).
   */
  async restrict(
    capabilityId: string,
    context: ComplianceDecisionContext & { restriction: ComplianceRestriction },
  ): Promise<ComplianceQueueItem> {
    const restriction = normalizeRestriction(context.restriction);
    return this.decide(capabilityId, 'RESTRICTED', context, AUDIT_ACTIONS.complianceRestricted, {
      restriction,
    });
  }

  /**
   * Orderability gate — the single check T013 (orders) must call.
   *
   * A teacher whose compliance is `PENDING`, `UNDER_REVIEW`, `REJECTED` or
   * `SUSPENDED` can never be ordered, and a `RESTRICTED` teacher can only be
   * ordered inside the granted scope (`specs/06` §Teacher compliance).
   */
  async assertOrderable(
    providerId: string,
    capabilityType: CapabilityType,
    context: ServiceComplianceContext = {},
  ): Promise<ProviderCapability> {
    const capability = await this.capabilities.findByProviderAndType(providerId, capabilityType);
    if (!capability) {
      throw complianceNotFound();
    }

    if (!isOrderable(capability, context)) {
      throw complianceNotPermitted(
        `Capability ${capabilityType} in compliance state ${capability.complianceStatus} cannot be ordered.`,
      );
    }

    return capability;
  }

  /** One decision: state command + audit row. */
  private async decide(
    capabilityId: string,
    target: ComplianceStatus,
    context: ComplianceDecisionContext,
    action: string,
    changes: { restriction: ComplianceRestriction | null },
  ): Promise<ComplianceQueueItem> {
    const reasonCode = requireReasonCode(context.reasonCode);
    const capability = await this.requireCapability(capabilityId);

    if (!requiresCompliance(capability.capabilityType)) {
      throw complianceInvalidState(
        `Capability ${capability.capabilityType} does not require a compliance review.`,
      );
    }

    if (!canTransitionCompliance(capability.complianceStatus, target)) {
      throw complianceInvalidState(
        `A capability in compliance state ${capability.complianceStatus} cannot become ${target}.`,
      );
    }

    const updated = await this.capabilities.update(capabilityId, {
      complianceStatus: target,
      restrictionJson: changes.restriction,
    });

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action,
      resourceType: 'provider_capability',
      resourceId: capabilityId,
      beforeJson: snapshot(capability),
      afterJson: {
        ...snapshot(updated),
        reasonCode,
        ...(context.notes ? { notes: context.notes } : {}),
      },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    const names = await this.providerNames([updated.providerId]);
    return { capability: updated, providerName: names.get(updated.providerId) ?? '' };
  }

  private async requireCapability(capabilityId: string): Promise<ProviderCapability> {
    const capability = await this.capabilities.findById(capabilityId);
    if (!capability) {
      throw complianceNotFound();
    }
    return capability;
  }

  /** Batch read of provider names, so the queue never queries per row. */
  private async providerNames(providerIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(providerIds)];
    if (unique.length === 0) {
      return new Map();
    }
    const profiles = await this.profiles.findManyByIds(unique);
    return new Map(profiles.map((profile) => [profile.id, profile.publicName]));
  }
}

/** Every decision carries a reason code (`specs/06` §Admin decisions). */
function requireReasonCode(reasonCode: string | undefined): string {
  const trimmed = reasonCode?.trim();
  if (!trimmed) {
    throw complianceInvalidState('A reason code is required for a compliance decision.');
  }
  return trimmed;
}

/** Before/after snapshot of the fields a compliance decision may change. */
function snapshot(capability: ProviderCapability): Record<string, unknown> {
  return {
    capabilityType: capability.capabilityType,
    complianceStatus: capability.complianceStatus,
    restriction: parseRestriction(capability.restrictionJson),
  };
}
