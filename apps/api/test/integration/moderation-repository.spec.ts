import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaModerationRepository } from '../../src/modules/moderation/infrastructure/prisma-moderation.repository';
import { ACTIVE_MODERATION_STATUSES } from '../../src/modules/moderation/domain/moderation-policy';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Moderation persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §reports / §moderation_cases).
 *
 * The two invariants the workflow depends on live here: a report and its case are
 * written together, and a target has at most one *active* case.
 */
describeWithDatabase('moderation repository (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let repository: PrismaModerationRepository;

  const userIds: string[] = [];
  const targetId = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    await prisma.$connect();
    repository = new PrismaModerationRepository(prisma);

    const reporter = await prisma.user.create({
      data: { displayName: '举报人', status: 'ACTIVE' },
    });
    const other = await prisma.user.create({ data: { displayName: '另一位', status: 'ACTIVE' } });
    userIds.push(reporter.id, other.id);
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { targetId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('writes the report and its case together', async () => {
    const first = await repository.createReportWithCase(
      {
        reporterUserId: userIds[0]!,
        targetType: 'USER',
        targetId,
        reasonCode: 'HARASSMENT',
        description: '骚扰内容',
      },
      ACTIVE_MODERATION_STATUSES,
    );

    expect(first.caseCreated).toBe(true);
    expect(first.report.status).toBe('PENDING');
    expect(first.moderationCase.status).toBe('OPEN');
    expect((await repository.findReportById(first.report.id))?.description).toBe('骚扰内容');
    expect((await repository.findCaseByReportId(first.report.id))?.id).toBe(
      first.moderationCase.id,
    );
  });

  it('keeps at most one active case per target', async () => {
    const openBefore = await repository.listQueue({ status: 'OPEN', skip: 0, take: 10 });

    const second = await repository.createReportWithCase(
      {
        reporterUserId: userIds[1]!,
        targetType: 'USER',
        targetId,
        reasonCode: 'FRAUD',
        description: null,
      },
      ACTIVE_MODERATION_STATUSES,
    );

    // A second intake on the same target joins the case that is already open:
    // the report is still recorded, no second case is created.
    expect(second.caseCreated).toBe(false);
    expect(second.moderationCase.id).toBe(openBefore.items[0]?.moderationCase?.id);
    expect((await repository.findReportById(second.report.id))?.reasonCode).toBe('FRAUD');
    expect((await repository.listQueue({ status: 'OPEN', skip: 0, take: 10 })).total).toBe(
      openBefore.total,
    );
  });

  it('records the outcome on the report and on the case', async () => {
    const created = await repository.createReportWithCase(
      {
        reporterUserId: userIds[0]!,
        targetType: 'USER',
        targetId,
        reasonCode: 'OTHER',
        description: null,
      },
      ACTIVE_MODERATION_STATUSES,
    );

    const report = await repository.updateReport(created.report.id, {
      status: 'RESOLVED',
      resolution: '已警告',
      moderatorId: userIds[0]!,
    });
    expect(report).toMatchObject({ status: 'RESOLVED', resolution: '已警告' });

    const moderationCase = await repository.updateCase(created.moderationCase.id, {
      status: 'RESOLVED',
      decision: 'RESOLVED',
      decisionReason: '已警告',
      actionTaken: 'NO_ACTION',
      assignedModeratorId: userIds[0]!,
      severity: 'MEDIUM',
    });
    expect(moderationCase).toMatchObject({
      status: 'RESOLVED',
      decision: 'RESOLVED',
      actionTaken: 'NO_ACTION',
      severity: 'MEDIUM',
    });

    // Resolved is no longer active, so a new report opens a fresh case.
    const reopened = await repository.createReportWithCase(
      {
        reporterUserId: userIds[1]!,
        targetType: 'USER',
        targetId,
        reasonCode: 'OTHER',
        description: null,
      },
      ACTIVE_MODERATION_STATUSES,
    );
    expect(reopened.caseCreated).toBe(true);
  });
});
