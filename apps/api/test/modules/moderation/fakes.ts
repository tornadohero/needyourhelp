import type { ModerationCaseStatusName } from '@mentor/api-contracts';

import type {
  CasePatch,
  CreateReportInput,
  ModerationCaseRecord,
  ModerationRepository,
  QueueItem,
  QueueQuery,
  ReportOutcomePatch,
  ReportRecord,
} from '../../../src/modules/moderation/domain/moderation.repository';

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/** In-memory {@link ModerationRepository}: intake plus the case workflow. */
export class FakeModerationRepository implements ModerationRepository {
  readonly reports: ReportRecord[] = [];
  readonly cases: ModerationCaseRecord[] = [];

  async createReportWithCase(
    input: CreateReportInput,
    activeStatuses: readonly ModerationCaseStatusName[],
  ): Promise<{ report: ReportRecord; moderationCase: ModerationCaseRecord; caseCreated: boolean }> {
    const report: ReportRecord = {
      id: nextId('report'),
      reporterUserId: input.reporterUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      description: input.description,
      status: 'PENDING',
      resolution: null,
      moderatorId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.reports.push(report);

    // One active case per target: a second report joins the existing one.
    const existing = this.cases.find(
      (record) =>
        record.targetType === input.targetType &&
        record.targetId === input.targetId &&
        activeStatuses.includes(record.status),
    );
    if (existing) {
      return { report, moderationCase: existing, caseCreated: false };
    }

    const created: ModerationCaseRecord = {
      id: nextId('case'),
      sourceReportId: report.id,
      caseType: 'REPORT',
      targetType: input.targetType,
      targetId: input.targetId,
      status: 'OPEN',
      severity: null,
      assignedModeratorId: null,
      decision: null,
      decisionReason: null,
      actionTaken: null,
      appealReason: null,
      appealReviewerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cases.push(created);
    return { report, moderationCase: created, caseCreated: true };
  }

  async findReportById(id: string): Promise<ReportRecord | null> {
    return this.reports.find((report) => report.id === id) ?? null;
  }

  async findCaseById(id: string): Promise<ModerationCaseRecord | null> {
    return this.cases.find((record) => record.id === id) ?? null;
  }

  async findCaseByReportId(reportId: string): Promise<ModerationCaseRecord | null> {
    const bySource = this.cases.find((record) => record.sourceReportId === reportId);
    if (bySource) {
      return bySource;
    }
    // A report that joined a case already open on the same target belongs to
    // it: the newest case on that target is the one the decision was made on.
    const report = this.reports.find((row) => row.id === reportId);
    if (!report) {
      return null;
    }
    return (
      [...this.cases]
        .reverse()
        .find(
          (record) =>
            record.targetType === report.targetType && record.targetId === report.targetId,
        ) ?? null
    );
  }

  async listReportsByReporter(
    reporterUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: QueueItem[]; total: number }> {
    const matching = this.reports
      .filter((report) => report.reporterUserId === reporterUserId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return {
      items: matching.slice(options.skip, options.skip + options.take).map((report) => ({
        report,
        moderationCase: this.cases.find((record) => record.sourceReportId === report.id) ?? null,
      })),
      total: matching.length,
    };
  }

  async listQueue(query: QueueQuery): Promise<{ items: QueueItem[]; total: number }> {
    const matching = this.cases
      .filter((record) => (query.status ? record.status === query.status : true))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return {
      items: matching.slice(query.skip, query.skip + query.take).map((record) => ({
        report: this.reports.find((report) => report.id === record.sourceReportId) ?? null,
        moderationCase: record,
      })),
      total: matching.length,
    };
  }

  async updateReport(id: string, patch: ReportOutcomePatch): Promise<ReportRecord> {
    const report = this.reports.find((row) => row.id === id);
    if (!report) {
      throw new Error(`unknown report ${id}`);
    }
    const updated: ReportRecord = {
      ...report,
      status: patch.status,
      resolution: patch.resolution,
      moderatorId: patch.moderatorId,
      updatedAt: new Date(),
    };
    this.reports[this.reports.indexOf(report)] = updated;
    return updated;
  }

  async updateCase(id: string, patch: CasePatch): Promise<ModerationCaseRecord> {
    const record = this.cases.find((row) => row.id === id);
    if (!record) {
      throw new Error(`unknown case ${id}`);
    }
    const updated: ModerationCaseRecord = {
      ...record,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.severity === undefined ? {} : { severity: patch.severity }),
      ...(patch.assignedModeratorId === undefined
        ? {}
        : { assignedModeratorId: patch.assignedModeratorId }),
      ...(patch.decision === undefined ? {} : { decision: patch.decision }),
      ...(patch.decisionReason === undefined ? {} : { decisionReason: patch.decisionReason }),
      ...(patch.actionTaken === undefined ? {} : { actionTaken: patch.actionTaken }),
      ...(patch.appealReason === undefined ? {} : { appealReason: patch.appealReason }),
      ...(patch.appealReviewerId === undefined ? {} : { appealReviewerId: patch.appealReviewerId }),
      updatedAt: new Date(),
    };
    this.cases[this.cases.indexOf(record)] = updated;
    return updated;
  }
}
