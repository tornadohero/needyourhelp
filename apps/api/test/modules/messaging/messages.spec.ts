import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConversationService } from '../../../src/modules/messaging/application/conversation.service';
import {
  assertMessageBody,
  assertMessageLimit,
} from '../../../src/modules/messaging/domain/conversation-policy';
import { FakeBlockRepository } from './fakes';
import { FakeConversationRepository } from './fakes';
import { FakeMessagingGateway } from './fakes';
import { FakeUserRepository } from '../profile/fakes';

/**
 * Sending and reading messages (T028 gap G4).
 *
 * The content stays with the transport — the platform stores a reference — but
 * every gate is enforced here: membership, an open conversation, and no block in
 * either direction (`specs/09-im-spec.md` §Safety).
 */
function build() {
  const conversations = new FakeConversationRepository();
  const gateway = new FakeMessagingGateway();
  const blocks = new FakeBlockRepository();
  const users = new FakeUserRepository();
  const service = new ConversationService(
    conversations,
    blocks,
    // Moderation is not involved in sending a message.
    { createReportWithCase: async () => ({ report: {}, moderationCase: {} }) } as never,
    gateway,
    users,
    { findDiscoverable: async () => null } as never,
  );
  return { service, conversations, gateway, blocks, users };
}

/**
 * Accounts are addressed by UUID (the domain checks the shape), so the fake is
 * seeded with real UUIDs instead of its generated ids.
 */
function seedUser(users: FakeUserRepository): string {
  const id = randomUUID();
  users.users.set(id, {
    id,
    status: 'ACTIVE',
    wechatOpenidHash: null,
    unionidHash: null,
    displayName: `用户-${id.slice(0, 8)}`,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  return id;
}

async function participants(users: FakeUserRepository) {
  return { a: seedUser(users), b: seedUser(users) };
}

async function openConversation(service: ConversationService, a: string, b: string) {
  return service.create(a, { peerUserId: b });
}

describe('message policy', () => {
  it('trims, bounds and rejects an empty body', () => {
    expect(assertMessageBody('  你好  ')).toBe('你好');
    expect(() => assertMessageBody('   ')).toThrow();
    expect(() => assertMessageBody('x'.repeat(2_001))).toThrow();
  });

  it('bounds the thread page', () => {
    expect(assertMessageLimit(undefined)).toBe(20);
    expect(assertMessageLimit(500)).toBe(50);
    expect(() => assertMessageLimit(0)).toThrow();
  });
});

describe('ConversationService messages', () => {
  it('sends a message, keeps only a reference, and reads it back', async () => {
    const { service, conversations, gateway, users } = build();
    const { a, b } = await participants(users);
    const conversation = await openConversation(service, a, b);

    const sent = await service.sendMessage(a, conversation.id, { body: '你好，请问有时间吗？' });

    // The transport got the content…
    expect(gateway.sentMessages).toHaveLength(1);
    expect(gateway.sentMessages[0]).toMatchObject({
      senderUserId: a,
      body: '你好，请问有时间吗？',
    });
    // …and the platform kept only a reference, with no content in it.
    const stored = conversations.messageReferences[0];
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('你好');
    expect(sent.reference.id).toBe(stored?.id);

    const thread = await service.listMessages(a, conversation.id, { limit: 10 });
    expect(thread.items).toHaveLength(1);
    expect(thread.items[0]).toMatchObject({ senderUserId: a, body: '你好，请问有时间吗？' });
  });

  it('is members only', async () => {
    const { service, users } = build();
    const { a, b } = await participants(users);
    const conversation = await openConversation(service, a, b);

    await expect(
      service.sendMessage('stranger', conversation.id, { body: '有人在吗' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(service.listMessages('stranger', conversation.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a blocked pair in either direction', async () => {
    const { service, blocks, users } = build();
    const { a, b } = await participants(users);
    const conversation = await openConversation(service, a, b);

    // `user-b` blocked `user-a`: neither direction may deliver.
    await blocks.add(b, a);

    await expect(service.sendMessage(a, conversation.id, { body: '还在吗' })).rejects.toMatchObject(
      {
        code: 'BLOCKED_USER',
      },
    );
  });

  it('refuses a conversation that is not open', async () => {
    const { service, conversations, users } = build();
    const { a, b } = await participants(users);
    const conversation = await openConversation(service, a, b);
    await conversations.setStatus(conversation.id, 'BLOCKED');

    await expect(service.sendMessage(a, conversation.id, { body: '还在吗' })).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
  });
});
