import { Inject, Injectable } from '@nestjs/common';
import type {
  ModerationActionName,
  ModerationCaseStatusName,
  ModerationTargetTypeName,
  ReportReasonCodeName,
  ReportStatusName,
} from '@mentor/api-contracts';

import { AUDIT_ACTIONS } from '../../audit/domain/audit-log.model';
import { AUDIT_LOG_REPOSITORY } from '../../audit/domain/audit-log.repository';
import type { AuditLogRepository } from '../../audit/domain/audit-log.repository';
import { OrderService } from '../../orders/application/order.service';
import { PROVIDER_PROFILE_REPOSITORY } from '../../provider/domain/provider-profile.repository';
import type { ProviderProfileRepository } from '../../provider/domain/provider-profile.repository';
import { REVIEW_REPOSITORY } from '../../reviews/domain/review.repository';
import type { ReviewRepository } from '../../reviews/domain/review.repository';
import { SERVICE_REPOSITORY } from '../../services/domain/service.repository';
import type { ServiceRepository } from '../../services/domain/service.repository';
import {
  ACTIVE_MODERATION_STATUSES,
  assertActionAllowed,
  assertAppealReason,
  assertCaseTransition,
  assertDescription,
  assertIndependentReview,
  assertPage,
  assertPageSize,
  assertResolution,
  assertTargetId,
} from '../domain/moderation-policy';
import { MODERATION_REPOSITORY } from '../domain/moderation.repository';
import type {
  ModerationCaseRecord,
  ModerationRepository,
  QueueItem,
} from '../domain/moderation.repository';
import {
  moderationForbidden,
  moderationInvalidRequest,
  moderationNotFound,
} from '../domain/moderation.errors';

export interface ModerationActor {
  /** The admin/ops account: every decision is recorded with its actor. */
  actorUserId: string;
  requestId: string;
  ipHash?: string | null;
}

export interface CreateReportCommand {
  targetType: ModerationTargetTypeName;
  targetId: string;
  reasonCode: ReportReasonCodeName;
  description?: string | null;
}

export interface ResolveReportCommand {
  resolution: string;
  /** `DISMISSED` when the report is rejected; `RESOLVED` otherwise. */
  outcome?: Extract<ReportStatusName, 'RESOLVED' | 'DISMISSED'>;
  action?: ModerationActionName;
  severity?: string | null;
}

export interface QueueQueryInput {
  status?: ModerationCaseStatusName | null;
  page?: number;
  pageSize?: number;
}

/**
 * Moderation (`specs/05-api-spec.md` §Reports / §Admin,
 * `specs/06-verification-state-machine.md` §Moderation,
 * `specs/12-admin-spec.md` §Moderation).
 *
 * `reports` is the intake and `moderation_cases` owns the workflow. Two rules
 * define this service:
 * - **every admin action is audited**, with actor, reason, before/after snapshot
 *   and request id;
 * - **an appeal is reviewed independently** — never by the moderator whose
 *   decision is being appealed.
 *
 * An action is only ever taken on the target the decision was made about:
 * hiding content means hiding a review, disputing means moving an order to
 * `DISPUTED`.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(PROVIDER_PROFILE_REPOSITORY) private readonly profiles: ProviderProfileRepository,
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepository,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  /**
   * `POST /reports`.
   *
   * Anybody may report; what they get back is only the outcome, never the
   * workflow behind it (`AGENTS.md` §9: internal moderation notes stay
   * internal).
   */
  async createReport(
    reporterUserId: string,
    command: CreateReportCommand,
  ): Promise<{ reportId: string; caseId: string; caseCreated: boolean }> {
    const description = assertDescription(command.description);
    assertTargetId(command.targetId);

    const result = await this.moderation.createReportWithCase(
      {
        reporterUserId,
        targetType: command.targetType,
        targetId: command.targetId,
        reasonCode: command.reasonCode,
        description,
      },
      ACTIVE_MODERATION_STATUSES,
    );

    return {
      reportId: result.report.id,
      caseId: result.moderationCase.id,
      caseCreated: result.caseCreated,
    };
  }

  /** `GET /me/reports`: what the caller reported, newest first. */
  async listOwnReports(
    reporterUserId: string,
    query: QueueQueryInput = {},
  ): Promise<{ items: QueueItem[]; total: number; page: number; pageSize: number }> {
    const page = assertPage(query.page ?? 1);
    const pageSize = assertPageSize(query.pageSize ?? 20);

    const result = await this.moderation.listReportsByReporter(reporterUserId, {
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  /** `GET /admin/reports`: the queue (`specs/12`: newest first). */
  async listQueue(query: QueueQueryInput = {}) {
    const page = assertPage(query.page ?? 1);
    const pageSize = assertPageSize(query.pageSize ?? 20);

    const result = await this.moderation.listQueue({
      status: query.status ?? null,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ...result, page, pageSize };
  }

  /**
   * `POST /admin/reports/:id/resolve`: the audited decision.
   *
   * The report is closed, the case is resolved, the optional action is applied
   * to the target, and one audit row records actor, reason and before/after.
   */
  async resolveReport(
    actor: ModerationActor,
    reportId: string,
    command: ResolveReportCommand,
  ): Promise<{
    reportId: string;
    caseId: string;
    reportStatus: ReportStatusName;
    caseStatus: ModerationCaseStatusName;
    actionTaken: ModerationActionName;
  }> {
    const resolution = assertResolution(command.resolution);
    const outcome: ReportStatusName = command.outcome ?? 'RESOLVED';
    const action: ModerationActionName = command.action ?? 'NO_ACTION';

    const report = await this.moderation.findReportById(reportId);
    if (!report) {
      throw moderationNotFound('Report not found.');
    }
    if (report.status === 'RESOLVED' || report.status === 'DISMISSED') {
      throw moderationInvalidRequest(`This report is already ${report.status}.`);
    }

    const moderationCase = await this.moderation.findCaseByReportId(report.id);
    if (!moderationCase) {
      throw moderationNotFound('This report has no moderation case.');
    }

    assertActionAllowed(action, moderationCase.targetType);
    assertCaseTransition(moderationCase.status, 'RESOLVED');

    const updatedReport = await this.moderation.updateReport(report.id, {
      status: outcome,
      resolution,
      moderatorId: actor.actorUserId,
    });

    const updatedCase = await this.moderation.updateCase(moderationCase.id, {
      status: 'RESOLVED',
      assignedModeratorId: moderationCase.assignedModeratorId ?? actor.actorUserId,
      decision: outcome,
      decisionReason: resolution,
      actionTaken: action,
      severity: command.severity ?? moderationCase.severity,
    });

    // The action runs on the target the decision was taken about, and nowhere
    // else: hiding hides that review, disputing disputes that order.
    const appliedAction = await this.applyAction(
      action,
      moderationCase.targetType,
      moderationCase.targetId,
    );

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.moderationResolved,
      resourceType: 'moderation_case',
      resourceId: updatedCase.id,
      beforeJson: {
        reportStatus: report.status,
        caseStatus: moderationCase.status,
        targetType: moderationCase.targetType,
        targetId: moderationCase.targetId,
      },
      afterJson: {
        reportStatus: updatedReport.status,
        caseStatus: updatedCase.status,
        actionTaken: appliedAction,
        resolution,
      },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return {
      reportId: updatedReport.id,
      caseId: updatedCase.id,
      reportStatus: updatedReport.status,
      caseStatus: updatedCase.status,
      actionTaken: appliedAction,
    };
  }

  /** `POST /admin/moderation/:id/transition`: move a case through the machine. */
  async transitionCase(
    actor: ModerationActor,
    caseId: string,
    command: { status: ModerationCaseStatusName; note?: string | null },
  ) {
    const moderationCase = await this.moderation.findCaseById(caseId);
    if (!moderationCase) {
      throw moderationNotFound('Case not found.');
    }
    assertCaseTransition(moderationCase.status, command.status);
    if (
      command.status === 'RESOLVED' ||
      command.status === 'APPEALED' ||
      command.status === 'FINALIZED'
    ) {
      // Those belong to the audited decision commands, which record a reason.
      throw moderationInvalidRequest(
        `Use the decision command to move a case to ${command.status}.`,
      );
    }

    const updated = await this.moderation.updateCase(moderationCase.id, {
      status: command.status,
      assignedModeratorId: moderationCase.assignedModeratorId ?? actor.actorUserId,
      decisionReason: command.note ?? moderationCase.decisionReason,
    });

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.moderationCaseTransitioned,
      resourceType: 'moderation_case',
      resourceId: updated.id,
      beforeJson: { caseStatus: moderationCase.status },
      afterJson: { caseStatus: updated.status, note: command.note ?? null },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return updated;
  }

  /**
   * `POST /reports/:id/appeal`: the appeal path of `specs/06`.
   *
   * The reporter and — where the target has an owner — the owner may appeal a
   * resolved decision. The case reopens as `APPEALED`; only a different
   * moderator can close it.
   */
  async appeal(
    userId: string,
    reportId: string,
    command: { reason: string; requestId: string },
  ): Promise<ModerationCaseRecord> {
    const reason = assertAppealReason(command.reason);

    const report = await this.moderation.findReportById(reportId);
    if (!report) {
      throw moderationNotFound('Report not found.');
    }
    if (
      report.reporterUserId !== userId &&
      !(await this.isTargetOwner(userId, report.targetType, report.targetId))
    ) {
      throw moderationForbidden('Only the people involved in this report can appeal it.');
    }

    const moderationCase = await this.moderation.findCaseByReportId(report.id);
    if (!moderationCase) {
      throw moderationNotFound('This report has no moderation case.');
    }
    assertCaseTransition(moderationCase.status, 'APPEALED');

    const updated = await this.moderation.updateCase(moderationCase.id, {
      status: 'APPEALED',
      appealReason: reason,
    });

    await this.audit.record({
      actorUserId: userId,
      actorType: 'USER',
      action: AUDIT_ACTIONS.moderationAppealFiled,
      resourceType: 'moderation_case',
      resourceId: updated.id,
      beforeJson: { caseStatus: moderationCase.status },
      afterJson: { caseStatus: updated.status, appealReason: reason },
      ipHash: null,
      requestId: command.requestId,
    });

    return updated;
  }

  /** `POST /admin/moderation/:id/finalize`: closes an appeal for good. */
  async finalizeAppeal(
    actor: ModerationActor,
    caseId: string,
    command: { decision: string; decisionReason: string },
  ) {
    const reason = assertResolution(command.decisionReason);
    const moderationCase = await this.moderation.findCaseById(caseId);
    if (!moderationCase) {
      throw moderationNotFound('Case not found.');
    }
    assertCaseTransition(moderationCase.status, 'FINALIZED');
    // `specs/06`: an appeal is reviewed by somebody else.
    assertIndependentReview(actor.actorUserId, moderationCase.assignedModeratorId);

    const updated = await this.moderation.updateCase(moderationCase.id, {
      status: 'FINALIZED',
      decision: command.decision,
      decisionReason: reason,
      appealReviewerId: actor.actorUserId,
    });

    await this.audit.record({
      actorUserId: actor.actorUserId,
      actorType: 'ADMIN',
      action: AUDIT_ACTIONS.moderationAppealFinalized,
      resourceType: 'moderation_case',
      resourceId: updated.id,
      beforeJson: {
        caseStatus: moderationCase.status,
        decision: moderationCase.decision,
        appealReason: moderationCase.appealReason,
      },
      afterJson: {
        caseStatus: updated.status,
        decision: updated.decision,
        decisionReason: reason,
        appealReviewedBy: actor.actorUserId,
      },
      ipHash: actor.ipHash ?? null,
      requestId: actor.requestId,
    });

    return updated;
  }

  private async applyAction(
    action: ModerationActionName,
    targetType: ModerationTargetTypeName,
    targetId: string,
  ): Promise<ModerationActionName> {
    if (action === 'HIDE_REVIEW' && targetType === 'REVIEW') {
      await this.reviews.setStatus(targetId, 'HIDDEN');
      return 'HIDE_REVIEW';
    }
    if (action === 'DISPUTE_ORDER' && targetType === 'ORDER') {
      await this.orders.markDispute(targetId);
      return 'DISPUTE_ORDER';
    }
    return 'NO_ACTION';
  }

  /** Who the decision was about, for the appeal right. */
  private async isTargetOwner(
    userId: string,
    targetType: ModerationTargetTypeName,
    targetId: string,
  ): Promise<boolean> {
    switch (targetType) {
      case 'USER':
        return userId === targetId;
      case 'PROVIDER': {
        const profile = await this.profiles.findById(targetId);
        return profile?.userId === userId;
      }
      case 'SERVICE': {
        const service = await this.services.findById(targetId);
        if (!service) {
          return false;
        }
        const profile = await this.profiles.findById(service.providerId);
        return profile?.userId === userId;
      }
      case 'ORDER': {
        const order = await this.orders.findById(targetId);
        if (!order) {
          return false;
        }
        if (order.buyerUserId === userId) {
          return true;
        }
        const profile = await this.profiles.findById(order.providerId);
        return profile?.userId === userId;
      }
      case 'REVIEW': {
        const review = await this.reviews.findById(targetId);
        return review?.revieweeUserId === userId;
      }
      default:
        // A message or a conversation has no single owner on our side: the
        // reporter is the only one who can appeal those.
        return false;
    }
  }
}
