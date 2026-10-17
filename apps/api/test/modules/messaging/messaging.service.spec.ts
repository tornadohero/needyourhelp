import { beforeEach, describe, expect, it } from 'vitest';

import { BlockService } from '../../../src/modules/messaging/application/block.service';
import { ConversationService } from '../../../src/modules/messaging/application/conversation.service';
import { FakeModerationRepository } from '../moderation/fakes';
import {
  DirectoryUserRepository,
  FakeBlockRepository,
  FakeConversationRepository,
  FakeMessagingGateway,
  FakeProviderDirectory,
} from './fakes';

const PROVIDER_ID = '00000000-0000-4000-8000-0000000000aa';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

function build(options: { discoverable?: boolean } = {}) {
  const conversations = new FakeConversationRepository();
  const blocks = new FakeBlockRepository();
  const moderation = new FakeModerationRepository();
  const gateway = new FakeMessagingGateway();
  const users = new DirectoryUserRepository({ [ALICE]: 'ACTIVE', [BOB]: 'ACTIVE' });
  const directory = new FakeProviderDirectory(options.discoverable !== false, BOB, PROVIDER_ID);

  return {
    conversationsService: new ConversationService(
      conversations,
      blocks,
      moderation,
      gateway,
      users,
      directory,
    ),
    blockService: new BlockService(blocks, conversations, gateway, users),
    conversations,
    blocks,
    moderation,
    gateway,
  };
}

type Context = ReturnType<typeof build>;

describe('ConversationService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('creates a conversation through the gateway', async () => {
    const conversation = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });

    expect(conversation.status).toBe('OPEN');
    expect(conversation.members.map((member) => member.userId).sort()).toEqual([ALICE, BOB].sort());
    // The transport was asked with the platform id, and its id is kept.
    expect(ctx.gateway.conversations[0]?.conversationId).toBe(conversation.id);
    expect(conversation.providerConversationId).toBe(`fake-conv-${conversation.id}`);
  });

  it('marks the provider side when the conversation is about a provider', async () => {
    const conversation = await ctx.conversationsService.create(ALICE, {
      peerUserId: BOB,
      providerId: PROVIDER_ID,
    });

    expect(conversation.members.find((member) => member.role === 'PROVIDER')?.userId).toBe(BOB);
    expect(conversation.members.find((member) => member.role === 'BUYER')?.userId).toBe(ALICE);
    expect(conversation.domain).toBe('TUTORING');
  });

  it('refuses a provider that is not discoverable', async () => {
    ctx = build({ discoverable: false });

    await expect(
      ctx.conversationsService.create(ALICE, { peerUserId: BOB, providerId: PROVIDER_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    // No transport was asked for: nothing was created at all.
    expect(ctx.gateway.conversations).toHaveLength(0);
    expect(ctx.conversations.conversations.size).toBe(0);
  });

  it('refuses to talk to oneself and to a missing account', async () => {
    await expect(
      ctx.conversationsService.create(ALICE, { peerUserId: ALICE }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.conversationsService.create(ALICE, { peerUserId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lists and reads only own conversations', async () => {
    const mine = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });
    await ctx.conversationsService.create(ALICE, { peerUserId: BOB });

    const page = await ctx.conversationsService.listMine(ALICE, { page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect((await ctx.conversationsService.listMine(BOB)).total).toBe(2);

    await expect(ctx.conversationsService.getForMember(ALICE, mine.id)).resolves.toMatchObject({
      id: mine.id,
    });

    // A non-member, an unknown id and a malformed id are all "not found": a
    // conversation id cannot be probed (`specs/13-security-spec.md`).
    for (const id of [mine.id, '44444444-4444-4444-8444-444444444444', 'not-a-uuid']) {
      await expect(ctx.conversationsService.getForMember(STRANGER, id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    }
  });

  it('sends a system message only through an open conversation', async () => {
    const conversation = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });

    await ctx.conversationsService.sendSystemMessage({
      conversationId: conversation.id,
      templateCode: 'ORDER_CREATED',
      params: { orderNo: 'MO-1' },
    });

    // Template code + params only: never rendered personal data.
    expect(ctx.gateway.systemMessages[0]).toMatchObject({
      conversationId: conversation.id,
      templateCode: 'ORDER_CREATED',
      params: { orderNo: 'MO-1' },
    });

    await ctx.conversations.setStatus(conversation.id, 'CLOSED');
    await expect(
      ctx.conversationsService.sendSystemMessage({
        conversationId: conversation.id,
        templateCode: 'ORDER_CREATED',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await expect(
      ctx.conversationsService.sendSystemMessage({
        conversationId: '55555555-5555-4555-8555-555555555555',
        templateCode: 'ORDER_CREATED',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creates a moderation case when a conversation is reported', async () => {
    const conversation = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });

    const first = await ctx.conversationsService.reportConversation(ALICE, conversation.id, {
      reasonCode: 'HARASSMENT',
      description: ' 骚扰 ',
    });

    expect(first).toMatchObject({ reasonCode: 'HARASSMENT', caseCreated: true });
    expect(ctx.moderation.reports[0]).toMatchObject({
      reporterUserId: ALICE,
      targetType: 'CONVERSATION',
      targetId: conversation.id,
      description: '骚扰',
    });
    expect(ctx.moderation.cases[0]).toMatchObject({
      sourceReportId: ctx.moderation.reports[0]?.id,
      status: 'OPEN',
    });

    // A second report of the same target reuses the active case
    // (`specs/04-database-spec.md` §moderation_cases).
    const second = await ctx.conversationsService.reportConversation(ALICE, conversation.id, {
      reasonCode: 'OTHER',
    });
    expect(second).toMatchObject({ caseCreated: false, caseId: first.caseId });
    expect(ctx.moderation.cases).toHaveLength(1);
    expect(ctx.moderation.reports).toHaveLength(2);

    // A non-member cannot report a conversation they cannot see.
    await expect(
      ctx.conversationsService.reportConversation(STRANGER, conversation.id, {
        reasonCode: 'OTHER',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('BlockService', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = build();
  });

  it('blocks, tells the transport and freezes the pair conversations', async () => {
    const conversation = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });

    const record = await ctx.blockService.block(ALICE, BOB);

    expect(record.blockedUserId).toBe(BOB);
    expect(ctx.gateway.blockedPairs).toEqual([{ blockerUserId: ALICE, blockedUserId: BOB }]);
    expect((await ctx.conversations.findById(conversation.id))?.status).toBe('BLOCKED');
  });

  it('stops new conversations in both directions', async () => {
    await ctx.blockService.block(ALICE, BOB);

    await expect(ctx.conversationsService.create(ALICE, { peerUserId: BOB })).rejects.toMatchObject(
      { code: 'BLOCKED_USER', status: 403 },
    );

    // The blocked account cannot start one either.
    await expect(ctx.conversationsService.create(BOB, { peerUserId: ALICE })).rejects.toMatchObject(
      { code: 'BLOCKED_USER' },
    );

    expect(ctx.gateway.conversations).toHaveLength(0);
  });

  it('re-opens what the block froze, and only that', async () => {
    const frozen = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });
    const closed = await ctx.conversationsService.create(ALICE, { peerUserId: BOB });
    await ctx.conversations.setStatus(closed.id, 'CLOSED');

    await ctx.blockService.block(ALICE, BOB);
    expect((await ctx.conversations.findById(frozen.id))?.status).toBe('BLOCKED');
    expect((await ctx.conversations.findById(closed.id))?.status).toBe('CLOSED');

    await ctx.blockService.unblock(ALICE, BOB);
    expect((await ctx.conversations.findById(frozen.id))?.status).toBe('OPEN');
    // A closed conversation stays closed.
    expect((await ctx.conversations.findById(closed.id))?.status).toBe('CLOSED');

    // Unblocked: messaging works again.
    await expect(
      ctx.conversationsService.create(ALICE, { peerUserId: BOB }),
    ).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('refuses to block oneself or an unknown account', async () => {
    await expect(ctx.blockService.block(ALICE, ALICE)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(ctx.blockService.block(ALICE, 'not-a-uuid')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
