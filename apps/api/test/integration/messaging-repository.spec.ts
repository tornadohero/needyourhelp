import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaBlockRepository } from '../../src/modules/messaging/infrastructure/prisma-block.repository';
import { PrismaConversationRepository } from '../../src/modules/messaging/infrastructure/prisma-conversation.repository';
import { PrismaModerationRepository } from '../../src/modules/moderation/infrastructure/prisma-moderation.repository';
import { ACTIVE_MODERATION_STATUSES } from '../../src/modules/moderation/domain/moderation-policy';
import { createTestPrismaService, describeWithDatabase } from './helpers/test-database';

/**
 * Messaging persistence against a real PostgreSQL database
 * (`specs/04-database-spec.md` §conversations, §conversation_members, §blocks,
 * §reports, §moderation_cases; `specs/09-im-spec.md`).
 */
describeWithDatabase('messaging repositories (database)', () => {
  const prisma: PrismaService = createTestPrismaService();
  let conversations: PrismaConversationRepository;
  let blocks: PrismaBlockRepository;
  let moderation: PrismaModerationRepository;

  const userIds: string[] = [];
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await prisma.$connect();
    conversations = new PrismaConversationRepository(prisma);
    blocks = new PrismaBlockRepository(prisma);
    moderation = new PrismaModerationRepository(prisma);

    alice = await newUser();
    bob = await newUser();
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({
      where: { members: { some: { userId: { in: userIds } } } },
    });
    await prisma.block.deleteMany({
      where: { OR: [{ blockerUserId: { in: userIds } }, { blockedUserId: { in: userIds } }] },
    });
    await prisma.moderationCase.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.report.deleteMany({ where: { reporterUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function newUser(): Promise<string> {
    const user = await prisma.user.create({ data: { displayName: '用户', status: 'ACTIVE' } });
    userIds.push(user.id);
    return user.id;
  }

  it('creates a conversation with both members in one write', async () => {
    const id = randomUUID();
    const created = await conversations.create({
      id,
      domain: 'TUTORING',
      providerConversationId: 'transport-1',
      members: [
        { userId: alice, role: 'BUYER' },
        { userId: bob, role: 'PROVIDER' },
      ],
    });

    expect(created.status).toBe('OPEN');
    expect(created.members).toHaveLength(2);
    expect(await prisma.conversationMember.count({ where: { conversationId: id } })).toBe(2);

    const found = await conversations.findById(id);
    expect(found?.providerConversationId).toBe('transport-1');
    expect(await conversations.findById(randomUUID())).toBeNull();
  });

  it('lists the conversations of one user, newest first and paged', async () => {
    const first = await conversations.create({
      id: randomUUID(),
      domain: 'TUTORING',
      providerConversationId: 'transport-2',
      members: [
        { userId: alice, role: 'BUYER' },
        { userId: bob, role: 'PROVIDER' },
      ],
    });
    await conversations.create({
      id: randomUUID(),
      domain: 'TUTORING',
      providerConversationId: 'transport-3',
      members: [
        { userId: alice, role: 'BUYER' },
        { userId: bob, role: 'PROVIDER' },
      ],
    });

    const page = await conversations.listByUser(alice, { page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    // `total` counts every match, not just the page.
    expect(page.total).toBeGreaterThanOrEqual(2);

    const all = await conversations.listByUser(alice, { page: 1, pageSize: 50 });
    expect(all.items.map((conversation) => conversation.id)).toContain(first.id);
    // Nobody else's conversation appears.
    const stranger = await newUser();
    expect((await conversations.listByUser(stranger, { page: 1, pageSize: 50 })).total).toBe(0);
  });

  it('freezes and re-opens the conversations of a pair', async () => {
    const id = randomUUID();
    await conversations.create({
      id,
      domain: 'TUTORING',
      providerConversationId: 'transport-4',
      members: [
        { userId: alice, role: 'BUYER' },
        { userId: bob, role: 'PROVIDER' },
      ],
    });

    const shared = await conversations.listBetweenUsers(alice, bob);
    expect(shared.map((conversation) => conversation.id)).toContain(id);

    const blocked = await conversations.setStatus(id, 'BLOCKED');
    expect(blocked.status).toBe('BLOCKED');
    const reopened = await conversations.setStatus(id, 'OPEN');
    expect(reopened.status).toBe('OPEN');

    // A conversation with only one of them is not part of the pair.
    const alone = await conversations.create({
      id: randomUUID(),
      domain: 'TUTORING',
      providerConversationId: 'transport-5',
      members: [{ userId: alice, role: 'BUYER' }],
    });
    expect((await conversations.listBetweenUsers(alice, bob)).map((c) => c.id)).not.toContain(
      alone.id,
    );
  });

  it('stores a block once and reads it in both directions', async () => {
    const blocked = await newUser();

    const record = await blocks.add(alice, blocked);
    expect(record.blockedUserId).toBe(blocked);
    // Idempotent: blocking twice keeps one row.
    await blocks.add(alice, blocked);
    expect(await prisma.block.count({ where: { blockerUserId: alice } })).toBe(1);

    expect(await blocks.existsBetween(alice, blocked)).toBe(true);
    expect(await blocks.existsBetween(blocked, alice)).toBe(true);

    expect(await blocks.remove(alice, blocked)).toBe(true);
    expect(await blocks.remove(alice, blocked)).toBe(false);
    expect(await blocks.existsBetween(alice, blocked)).toBe(false);
  });

  it('creates a report and its moderation case together', async () => {
    const targetId = randomUUID();

    const first = await moderation.createReportWithCase(
      {
        reporterUserId: alice,
        targetType: 'CONVERSATION',
        targetId,
        reasonCode: 'HARASSMENT',
        description: '骚扰',
      },
      ACTIVE_MODERATION_STATUSES,
    );

    expect(first.caseCreated).toBe(true);
    expect(first.moderationCase.sourceReportId).toBe(first.report.id);
    expect(first.moderationCase.status).toBe('OPEN');
    expect(first.report.status).toBe('PENDING');
    expect(await prisma.report.count({ where: { targetId } })).toBe(1);

    // A second report of the same target reuses the active case: at most one
    // active case per target (`specs/04-database-spec.md`).
    const second = await moderation.createReportWithCase(
      {
        reporterUserId: bob,
        targetType: 'CONVERSATION',
        targetId,
        reasonCode: 'OTHER',
        description: null,
      },
      ACTIVE_MODERATION_STATUSES,
    );

    expect(second.caseCreated).toBe(false);
    expect(second.moderationCase.id).toBe(first.moderationCase.id);
    expect(await prisma.moderationCase.count({ where: { targetId } })).toBe(1);

    // Once the case is closed, a new report opens a new case.
    await prisma.moderationCase.update({
      where: { id: first.moderationCase.id },
      data: { status: 'RESOLVED' },
    });
    const third = await moderation.createReportWithCase(
      {
        reporterUserId: alice,
        targetType: 'CONVERSATION',
        targetId,
        reasonCode: 'OTHER',
        description: null,
      },
      ACTIVE_MODERATION_STATUSES,
    );
    expect(third.caseCreated).toBe(true);
    expect(await prisma.moderationCase.count({ where: { targetId } })).toBe(2);
  });
});
