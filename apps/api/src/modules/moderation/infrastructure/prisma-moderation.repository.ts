import { Inject, Injectable } from '@nestjs/common';
import type {
  ModerationCaseStatusName,
  ModerationTargetTypeName,
  ReportReasonCodeName,
  ReportStatusName,
} from '@mentor/api-contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CasePatch,
  CreateReportInput,
  ModerationCaseRecord,
  ModerationRepository,
  QueueItem,
  QueueQuery,
  ReportOutcomePatch,
  ReportRecord,
} from '../domain/moderation.repository';

/** Prisma adapter for {@link ModerationRepository}. */
@Injectable()
export class PrismaModerationRepository implements ModerationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createReportWithCase(
    input: CreateReportInput,
    activeStatuses: readonly ModerationCaseStatusName[],
  ): Promise<{
    report: ReportRecord;
    moderationCase: ModerationCaseRecord;
    caseCreated: boolean;
  }> {
    return this.prisma.runInTransaction(async (tx) => {
      const report = await tx.report.create({
        data: {
          reporterUserId: input.reporterUserId,
          targetType: input.targetType,
          targetId: input.targetId,
          reasonCode: input.reasonCode,
          description: input.description,
          // Intake lifecycle; the case owns the moderation workflow.
          status: 'PENDING',
        },
      });

      const existing = await tx.moderationCase.findFirst({
        where: {
          targetType: input.targetType,
          targetId: input.targetId,
          status: { in: [...activeStatuses] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return {
          report: mapReport(report),
          moderationCase: mapCase(existing),
          caseCreated: false,
        };
      }

      const created = await tx.moderationCase.create({
        data: {
          sourceReportId: report.id,
          caseType: 'REPORT',
          targetType: input.targetType,
          targetId: input.targetId,
          status: 'OPEN',
        },
      });

      return { report: mapReport(report), moderationCase: mapCase(created), caseCreated: true };
    });
  }

  async findReportById(id: string): Promise<ReportRecord | null> {
    const row = await this.prisma.report.findUnique({ where: { id } });
    return row ? mapReport(row) : null;
  }

  async findCaseById(id: string): Promise<ModerationCaseRecord | null> {
    const row = await this.prisma.moderationCase.findUnique({ where: { id } });
    return row ? mapCase(row) : null;
  }

  async findCaseByReportId(reportId: string): Promise<ModerationCaseRecord | null> {
    const bySource = await this.prisma.moderationCase.findFirst({
      where: { sourceReportId: reportId },
    });
    if (bySource) {
      return mapCase(bySource);
    }

    // A report that joined a case already open on the same target belongs to
    // that case: there is only ever one active case per target, and after a
    // decision it is still the case the decision — and any appeal — was made on.
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { targetType: true, targetId: true },
    });
    if (!report) {
      return null;
    }
    const byTarget = await this.prisma.moderationCase.findFirst({
      where: { targetType: report.targetType, targetId: report.targetId },
      orderBy: { createdAt: 'desc' },
    });
    return byTarget ? mapCase(byTarget) : null;
  }

  async listReportsByReporter(
    reporterUserId: string,
    options: { skip: number; take: number },
  ): Promise<{ items: QueueItem[]; total: number }> {
    const where = { reporterUserId };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
      }),
      this.prisma.report.count({ where }),
    ]);

    const cases = await this.casesFor(rows.map((row) => row.id));
    return {
      items: rows.map((row) => ({
        report: mapReport(row),
        moderationCase: cases.get(row.id) ?? null,
      })),
      total,
    };
  }

  async listQueue(query: QueueQuery): Promise<{ items: QueueItem[]; total: number }> {
    // The queue is the case list: `specs/12` wants newest first, and a report
    // without a case (an intake on a target that already had one) still shows.
    const caseWhere = query.status ? { status: query.status } : {};
    const [cases, total] = await Promise.all([
      this.prisma.moderationCase.findMany({
        where: caseWhere,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.moderationCase.count({ where: caseWhere }),
    ]);

    const reports = await this.reportsFor(cases.map((row) => row.sourceReportId));
    return {
      items: cases.map((row) => ({
        report: (row.sourceReportId ? reports.get(row.sourceReportId) : null) ?? null,
        moderationCase: mapCase(row),
      })),
      total,
    };
  }

  async updateReport(id: string, patch: ReportOutcomePatch): Promise<ReportRecord> {
    const row = await this.prisma.report.update({
      where: { id },
      data: {
        status: patch.status,
        resolution: patch.resolution,
        moderatorId: patch.moderatorId,
      },
    });
    return mapReport(row);
  }

  async updateCase(id: string, patch: CasePatch): Promise<ModerationCaseRecord> {
    const row = await this.prisma.moderationCase.update({
      where: { id },
      data: {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.severity === undefined ? {} : { severity: patch.severity as never }),
        ...(patch.assignedModeratorId === undefined
          ? {}
          : { assignedModeratorId: patch.assignedModeratorId }),
        ...(patch.decision === undefined ? {} : { decision: patch.decision }),
        ...(patch.decisionReason === undefined ? {} : { decisionReason: patch.decisionReason }),
        ...(patch.actionTaken === undefined ? {} : { actionTaken: patch.actionTaken }),
        ...(patch.appealReason === undefined ? {} : { appealReason: patch.appealReason }),
        ...(patch.appealReviewerId === undefined
          ? {}
          : { appealReviewerId: patch.appealReviewerId }),
      },
    });
    return mapCase(row);
  }

  /** Batch read: a queue never queries per row. */
  private async reportsFor(ids: (string | null)[]): Promise<Map<string, ReportRecord>> {
    const known = ids.filter((id): id is string => id !== null);
    if (known.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.report.findMany({ where: { id: { in: known } } });
    return new Map(rows.map((row) => [row.id, mapReport(row)]));
  }

  private async casesFor(reportIds: string[]): Promise<Map<string, ModerationCaseRecord>> {
    if (reportIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.moderationCase.findMany({
      where: { sourceReportId: { in: reportIds } },
    });
    return new Map(
      rows
        .filter((row) => row.sourceReportId !== null)
        .map((row) => [row.sourceReportId as string, mapCase(row)]),
    );
  }
}

type ReportRow = {
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
};

type CaseRow = {
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
};

function mapReport(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    reporterUserId: row.reporterUserId,
    targetType: row.targetType,
    targetId: row.targetId,
    reasonCode: row.reasonCode,
    description: row.description,
    status: row.status,
    resolution: row.resolution,
    moderatorId: row.moderatorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCase(row: CaseRow): ModerationCaseRecord {
  return {
    id: row.id,
    sourceReportId: row.sourceReportId,
    caseType: row.caseType,
    targetType: row.targetType,
    targetId: row.targetId,
    status: row.status,
    severity: row.severity,
    assignedModeratorId: row.assignedModeratorId,
    decision: row.decision,
    decisionReason: row.decisionReason,
    actionTaken: row.actionTaken,
    appealReason: row.appealReason,
    appealReviewerId: row.appealReviewerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
