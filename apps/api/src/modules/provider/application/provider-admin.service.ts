import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { PROVIDER_CAPABILITY_REPOSITORY } from '../domain/provider-capability.repository';
import type { ProviderCapabilityRepository } from '../domain/provider-capability.repository';
import type { ProviderProfile } from '../domain/provider-profile.model';
import { PROVIDER_PROFILE_REPOSITORY } from '../domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../domain/provider-profile.repository';
import { providerInvalidState, providerNotFound } from '../domain/provider.errors';
import { canTransition } from '../domain/provider-policy';
import type { ProviderApplication } from './provider-application.service';
import { ProviderApplicationService } from './provider-application.service';

export interface AdminDecisionContext {
  /** The authenticated admin/ops account: the actor recorded in the audit row. */
  actorUserId: string;
  /** Required for a rejection, optional for an approval. */
  reason?: string | null;
  requestId: string;
  ipHash?: string | null;
}

/**
 * Admin provider decisions (`specs/12-admin-spec.md` §Provider review workflow).
 *
 * Rules enforced here:
 * - a provider cannot approve itself: this service is only reachable through an
 *   admin route guarded by `RolesGuard` (`specs/07-permission-spec.md`);
 * - only the transitions defined by the state machine are allowed;
 * - every decision writes an audit row with actor, reason, before/after snapshot
 *   and request id (`specs/06-verification-state-machine.md` §Admin decision
 *   requirements).
 */
@Injectable()
export class ProviderAdminService {
  constructor(
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(PROVIDER_CAPABILITY_REPOSITORY)
    private readonly capabilities: ProviderCapabilityRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(ProviderApplicationService) private readonly applications: ProviderApplicationService,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `POST /admin/providers/:id/approve`. */
  async approve(providerId: string, context: AdminDecisionContext): Promise<ProviderApplication> {
    const profile = await this.requireProfile(providerId);

    if (!canTransition(profile.approvalStatus, 'APPROVED')) {
      throw providerInvalidState(
        `A provider application in status ${profile.approvalStatus} cannot be approved.`,
      );
    }

    const approved = await this.profiles.setApprovalStatus(profile.id, 'APPROVED');

    // Approval grants the provider role; it is never assigned by the client
    // (`AGENTS.md` §7) and it is audited as a role change.
    const grantedRole = await this.grantProviderRole(approved.userId, context);

    const searchable = await this.applications.refreshSearchable(approved);

    await this.analytics?.track({
      name: 'provider_approved',
      providerId: approved.id,
      props: {},
    });

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.providerApproved,
      resourceType: 'provider_profile',
      resourceId: profile.id,
      beforeJson: snapshot(profile),
      afterJson: { ...snapshot(searchable), roleGranted: grantedRole },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return {
      profile: searchable,
      capabilities: await this.capabilities.listByProvider(profile.id),
    };
  }

  /** `POST /admin/providers/:id/reject`. */
  async reject(providerId: string, context: AdminDecisionContext): Promise<ProviderApplication> {
    const reason = context.reason?.trim();
    if (!reason) {
      throw providerInvalidState('A rejection reason is required.');
    }

    const profile = await this.requireProfile(providerId);

    if (!canTransition(profile.approvalStatus, 'REJECTED')) {
      throw providerInvalidState(
        `A provider application in status ${profile.approvalStatus} cannot be rejected.`,
      );
    }

    const rejected = await this.profiles.setApprovalStatus(profile.id, 'REJECTED');
    const searchable = await this.applications.refreshSearchable(rejected);

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.providerRejected,
      resourceType: 'provider_profile',
      resourceId: profile.id,
      beforeJson: snapshot(profile),
      afterJson: { ...snapshot(searchable), reason },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return {
      profile: searchable,
      capabilities: await this.capabilities.listByProvider(profile.id),
    };
  }

  /**
   * `POST /admin/providers/:id/suspend` (`specs/12-admin-spec.md` §Provider
   * review workflow: "suspend").
   *
   * Suspension is orthogonal to approval (`APPROVED -> SUSPENDED -> APPROVED`),
   * and it takes the provider out of discovery immediately: a suspended provider
   * must not keep being booked while the case is open.
   */
  async suspend(providerId: string, context: AdminDecisionContext): Promise<ProviderApplication> {
    const reason = context.reason?.trim();
    if (!reason) {
      throw providerInvalidState('A suspension reason is required.');
    }

    const profile = await this.requireProfile(providerId);
    if (!canTransition(profile.approvalStatus, 'SUSPENDED')) {
      throw providerInvalidState(
        `A provider in status ${profile.approvalStatus} cannot be suspended.`,
      );
    }

    const suspended = await this.profiles.setApprovalStatus(profile.id, 'SUSPENDED');
    const searchable = await this.applications.refreshSearchable(suspended);

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.providerSuspended,
      resourceType: 'provider_profile',
      resourceId: profile.id,
      beforeJson: snapshot(profile),
      afterJson: { ...snapshot(searchable), reason },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return {
      profile: searchable,
      capabilities: await this.capabilities.listByProvider(profile.id),
    };
  }

  /** `POST /admin/providers/:id/restore`: back to `APPROVED`. */
  async restore(providerId: string, context: AdminDecisionContext): Promise<ProviderApplication> {
    const profile = await this.requireProfile(providerId);
    if (!canTransition(profile.approvalStatus, 'APPROVED')) {
      throw providerInvalidState(
        `A provider in status ${profile.approvalStatus} cannot be restored.`,
      );
    }

    const restored = await this.profiles.setApprovalStatus(profile.id, 'APPROVED');
    // Restoring does not make a provider visible by itself: every readiness gate
    // is re-read, the same way it is after an approval (T005).
    const searchable = await this.applications.refreshSearchable(restored);

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.providerRestored,
      resourceType: 'provider_profile',
      resourceId: profile.id,
      beforeJson: snapshot(profile),
      afterJson: { ...snapshot(searchable), reason: context.reason ?? null },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return {
      profile: searchable,
      capabilities: await this.capabilities.listByProvider(profile.id),
    };
  }

  private async requireProfile(providerId: string): Promise<ProviderProfile> {
    const profile = await this.profiles.findById(providerId);
    if (!profile) {
      throw providerNotFound();
    }
    return profile;
  }

  /** Idempotent role grant; returns `true` when the role was newly added. */
  private async grantProviderRole(userId: string, context: AdminDecisionContext): Promise<boolean> {
    const roles = await this.users.listRoles(userId);
    if (roles.includes('PROVIDER')) {
      return false;
    }

    await this.users.addRole(userId, 'PROVIDER');

    await this.audit.record({
      actorUserId: context.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.roleGranted,
      resourceType: 'user_role',
      resourceId: userId,
      beforeJson: { roles },
      afterJson: { roles: [...roles, 'PROVIDER'] },
      ipHash: context.ipHash ?? null,
      requestId: context.requestId,
    });

    return true;
  }
}

/** Before/after snapshot of the fields an admin decision may change. */
function snapshot(profile: ProviderProfile): Record<string, unknown> {
  return {
    approvalStatus: profile.approvalStatus,
    searchable: profile.searchable,
    publicName: profile.publicName,
    providerType: profile.providerType,
  };
}
