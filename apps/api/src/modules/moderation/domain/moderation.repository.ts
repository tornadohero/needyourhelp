import type {
  ModerationCaseStatusName,
  ModerationTargetTypeName,
  ReportReasonCodeName,
  ReportStatusName,
} from '@mentor/api-contracts';

/** Dependency-injection token for {@link ModerationRepository}. */
export const MODERATION_REPOSITORY = 'MODERATION_REPOSITORY';

/**
 * Domain view of `reports` and `moderation_cases`
 * (`specs/04-database-spec.md` §reports / §moderation_cases,
 * `specs/06-verification-state-machine.md` §Moderation).
 *
 * `reports` is the intake record: who reported what, and why. The workflow —
 * every state, decision and appeal — lives in `moderation_cases`, which is the
 * only table this context writes a status to. A target has at most one *active*
 * case at a time.
 *
 * This port was created for the messaging intake (T012) and is owned here from
 * T018 onwards.
 */
export interface ReportRecord {
  id: string;
  reporterUserId: string;
  targetType: ModerationTargetTypeName;
  targetId: string;
  reasonCode: ReportReasonCodeName;
  description: string | null;
  status: ReportStatusName;
  resolution: string | null;
  moderatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationCaseRecord {
  id: string;
  sourceReportId: string | null;
  caseType: 'REPORT' | 'APPEAL';
  targetType: ModerationTargetTypeName;
  targetId: string;
  status: ModerationCaseStatusName;
  severity: string | null;
  assignedModeratorId: string | null;
  decision: string | null;
  decisionReason: string | null;
  actionTaken: string | null;
  appealReason: string | null;
  appealReviewerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportInput {
  reporterUserId: string;
  targetType: ModerationTargetTypeName;
  targetId: string;
  reasonCode: ReportReasonCodeName;
  description: string | null;
}

/** What a moderator writes when closing a report. */
export interface ReportOutcomePatch {
  status: ReportStatusName;
  resolution: string;
  moderatorId: string;
}

/** What a moderator writes on the case that owns the workflow. */
export interface CasePatch {
  status?: ModerationCaseStatusName;
  severity?: string | null;
  assignedModeratorId?: string | null;
  decision?: string | null;
  decisionReason?: string | null;
  actionTaken?: string | null;
  appealReason?: string | null;
  appealReviewerId?: string | null;
}

export interface QueueQuery {
  status?: ModerationCaseStatusName | null;
  skip: number;
  take: number;
}

/**
 * One row of a listing.
 *
 * The queue is read from the case side, and an appeal case has no source
 * report, so `report` may be `null` there; a user's own listing is read from the
 * report side, and a report whose target already had an active case has no case
 * of its own.
 */
export interface QueueItem {
  report: ReportRecord | null;
  moderationCase: ModerationCaseRecord | null;
}

export interface ModerationRepository {
  /** Report and case are written together, or not at all. */
  createReportWithCase(
    input: CreateReportInput,
    activeStatuses: readonly ModerationCaseStatusName[],
  ): Promise<{ report: ReportRecord; moderationCase: ModerationCaseRecord; caseCreated: boolean }>;

  findReportById(id: string): Promise<ReportRecord | null>;

  findCaseById(id: string): Promise<ModerationCaseRecord | null>;

  /** The case an intake record opened. */
  findCaseByReportId(reportId: string): Promise<ModerationCaseRecord | null>;

  /** `GET /me/reports`: what the caller reported, newest first. */
  listReportsByReporter(
    reporterUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: QueueItem[]; total: number }>;

  /** `GET /admin/reports`: the queue, newest first (`specs/12-admin-spec.md`). */
  listQueue(query: QueueQuery): Promise<{ items: QueueItem[]; total: number }>;

  updateReport(id: string, patch: ReportOutcomePatch): Promise<ReportRecord>;

  updateCase(id: string, patch: CasePatch): Promise<ModerationCaseRecord>;
}
