/**
 * Moderation vocabulary shared by the messaging (T012) and moderation (T018)
 * contexts.
 *
 * Source of truth: `specs/04-database-spec.md` §reports / §moderation_cases,
 * `specs/06-verification-state-machine.md` §Moderation,
 * `specs/12-admin-spec.md` §Moderation ("Report categories", "Audit every …
 * moderation action").
 */

/** `reports.reason_code`. */
export const REPORT_REASON_CODES = [
  'FRAUD',
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'OFF_PLATFORM_TRANSACTION',
  'FAKE_CREDENTIALS',
  'UNSAFE_BEHAVIOR',
  'PAYMENT_ISSUE',
  'OTHER',
] as const;
export type ReportReasonCodeName = (typeof REPORT_REASON_CODES)[number];

/** `reports.target_type` / `moderation_cases.target_type`. */
export const MODERATION_TARGET_TYPES = [
  'USER',
  'PROVIDER',
  'SERVICE',
  'ORDER',
  'REVIEW',
  'MESSAGE',
  'CONVERSATION',
] as const;
export type ModerationTargetTypeName = (typeof MODERATION_TARGET_TYPES)[number];

/** `moderation_cases.status` (`specs/06-verification-state-machine.md` §Moderation). */
export const MODERATION_CASE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'ACTION_REQUIRED',
  'RESOLVED',
  'APPEALED',
  'FINALIZED',
] as const;
export type ModerationCaseStatusName = (typeof MODERATION_CASE_STATUSES)[number];

/** `reports.status`: the intake lifecycle behind the case. */
export const REPORT_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'ACTIONED',
  'RESOLVED',
  'DISMISSED',
] as const;
export type ReportStatusName = (typeof REPORT_STATUSES)[number];

/**
 * What a moderator decided to do, beyond writing the decision down.
 *
 * Every action is explicit and bounded: `HIDE_REVIEW` only applies to a review
 * and `DISPUTE_ORDER` only to an order, so a decision can never touch a target
 * it was not taken on.
 */
export const MODERATION_ACTIONS = ['NO_ACTION', 'HIDE_REVIEW', 'DISPUTE_ORDER'] as const;
export type ModerationActionName = (typeof MODERATION_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface ModerationCaseResponse {
  id: string;
  targetType: ModerationTargetTypeName;
  targetId: string;
  status: ModerationCaseStatusName;
  severity: string | null;
  decision: string | null;
  actionTaken: string | null;
  appealReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportResponse {
  id: string;
  targetType: ModerationTargetTypeName;
  targetId: string;
  reasonCode: ReportReasonCodeName;
  description: string | null;
  status: ReportStatusName;
  caseId: string | null;
  caseStatus: ModerationCaseStatusName | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportListResponse {
  items: ReportResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** One row of the admin queue: the report plus the case that owns the state. */
export interface AdminReportItemResponse extends ReportResponse {
  reporterUserId: string;
  resolution: string | null;
}

export interface AdminReportQueueResponse {
  items: AdminReportItemResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** `POST /reports`: intake only — the case is created behind it. */
export interface CreateReportResponse {
  reportId: string;
  caseId: string;
  /** `false` when the target already had an active case. */
  caseCreated: boolean;
}

/** `POST /admin/reports/:id/resolve` and the appeal commands. */
export interface ModerationDecisionResponse {
  reportId: string;
  caseId: string;
  reportStatus: ReportStatusName;
  caseStatus: ModerationCaseStatusName;
  actionTaken: ModerationActionName;
}
