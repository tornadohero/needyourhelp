import type {
  AdminReportItemResponse,
  AdminReportQueueResponse,
  CreateReportResponse,
  ModerationCaseResponse,
  ModerationDecisionResponse,
  ReportListResponse,
  ReportResponse,
} from '@mentor/api-contracts';

import type {
  ModerationCaseRecord,
  QueueItem,
  ReportRecord,
} from '../domain/moderation.repository';

/**
 * Response mappers for moderation.
 *
 * Allowlists, never ORM serialization (`AGENTS.md` §10): a reporter sees their
 * own intake, and the admin queue adds only what a moderator needs
 * (`specs/12-admin-spec.md` §Admin principles: "Search results are minimized by
 * role").
 */
export function toModerationCaseResponse(
  moderationCase: ModerationCaseRecord,
): ModerationCaseResponse {
  return {
    id: moderationCase.id,
    targetType: moderationCase.targetType,
    targetId: moderationCase.targetId,
    status: moderationCase.status,
    severity: moderationCase.severity,
    decision: moderationCase.decision,
    actionTaken: moderationCase.actionTaken,
    appealReason: moderationCase.appealReason,
    createdAt: moderationCase.createdAt.toISOString(),
    updatedAt: moderationCase.updatedAt.toISOString(),
  };
}

export function toReportResponse(
  report: ReportRecord,
  moderationCase: ModerationCaseRecord | null,
): ReportResponse {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reasonCode: report.reasonCode,
    description: report.description,
    status: report.status,
    caseId: moderationCase?.id ?? null,
    caseStatus: moderationCase?.status ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export function toReportListResponse(result: {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
}): ReportListResponse {
  return {
    items: result.items
      .filter((item): item is QueueItem & { report: ReportRecord } => item.report !== null)
      .map((item) => toReportResponse(item.report, item.moderationCase)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

export function toAdminReportQueueResponse(result: {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
}): AdminReportQueueResponse {
  const items: AdminReportItemResponse[] = result.items
    .filter((item): item is QueueItem & { report: ReportRecord } => item.report !== null)
    .map((item) => ({
      ...toReportResponse(item.report, item.moderationCase),
      reporterUserId: item.report.reporterUserId,
      resolution: item.report.resolution,
    }));

  return { items, total: result.total, page: result.page, pageSize: result.pageSize };
}

export function toCreateReportResponse(result: {
  reportId: string;
  caseId: string;
  caseCreated: boolean;
}): CreateReportResponse {
  return {
    reportId: result.reportId,
    caseId: result.caseId,
    caseCreated: result.caseCreated,
  };
}

export function toModerationDecisionResponse(result: {
  reportId: string;
  caseId: string;
  reportStatus: ReportRecord['status'];
  caseStatus: ModerationCaseRecord['status'];
  actionTaken: string;
}): ModerationDecisionResponse {
  return {
    reportId: result.reportId,
    caseId: result.caseId,
    reportStatus: result.reportStatus,
    caseStatus: result.caseStatus,
    actionTaken: result.actionTaken as ModerationDecisionResponse['actionTaken'],
  };
}
