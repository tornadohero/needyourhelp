import { describe, expect, it } from 'vitest';

import { counterpartOf, describeConversation, describeMessage, relativeTime } from './chat-view';
import type { ConversationResponse, MessageResponse } from '@mentor/api-contracts';

const NOW = new Date('2026-10-30T15:00:00.000Z');

function conversation(members: ConversationResponse['members']): ConversationResponse {
  return {
    id: 'conv-1',
    domain: 'TUTORING',
    orderId: null,
    status: 'OPEN',
    members,
    messages: [],
    createdAt: '2026-10-28T02:00:00.000Z',
    updatedAt: '2026-10-30T09:00:00.000Z',
  };
}

describe('relativeTime', () => {
  it('answers a clock for today, yesterday in words, a weekday this week', () => {
    expect(relativeTime('2026-10-30T14:05:00.000Z', NOW)).toBe('22:05');
    expect(relativeTime('2026-10-29T08:00:00.000Z', NOW)).toContain('昨天');
    // Within the same calendar week: the weekday is more useful than a date.
    expect(relativeTime('2026-10-27T08:00:00.000Z', NOW)).toBe('周二');
  });

  it('answers a date for anything older, with the year once it matters', () => {
    expect(relativeTime('2026-10-02T08:00:00.000Z', NOW)).toBe('10月2日');
    expect(relativeTime('2025-10-02T08:00:00.000Z', NOW)).toBe('2025年10月2日');
  });

  it('answers empty for a timestamp it cannot read', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('counterpartOf', () => {
  it('is the member who is not me, by their joined name', () => {
    const row = conversation([
      { userId: 'me', role: 'BUYER', displayName: '家长' },
      { userId: 'tutor', role: 'PROVIDER', displayName: '李老师' },
    ]);

    expect(counterpartOf(row, 'me').name).toBe('李老师');
  });

  it('degrades to the role, never to an invented name', () => {
    const row = conversation([
      { userId: 'me', role: 'BUYER', displayName: null },
      { userId: 'tutor', role: 'PROVIDER', displayName: '' },
    ]);

    expect(counterpartOf(row, 'me').name).toBe('导师');
  });
});

describe('describeConversation', () => {
  it('carries the last words and marks a booking thread', () => {
    const row = describeConversation({
      conversation: {
        ...conversation([
          { userId: 'me', role: 'BUYER', displayName: '家长' },
          { userId: 'tutor', role: 'PROVIDER', displayName: '李老师' },
        ]),
        orderId: 'order-1',
      },
      myUserId: 'me',
      lastMessage: {
        id: 'm1',
        conversationId: 'conv-1',
        senderUserId: 'tutor',
        messageType: 'TEXT',
        body: '周六上午的时段给您留出来了',
        moderationStatus: 'APPROVED',
        createdAt: '2026-10-30T14:05:00.000Z',
      },
    });

    expect(row.title).toBe('李老师');
    expect(row.preview).toBe('周六上午的时段给您留出来了');
    expect(row.orderLinked).toBe(true);
    expect(row.timeText).toBe('22:05');
  });

  it('answers an empty preview when the thread has no words yet', () => {
    const row = describeConversation({
      conversation: conversation([
        { userId: 'me', role: 'BUYER', displayName: '家长' },
        { userId: 'tutor', role: 'PROVIDER', displayName: '李老师' },
      ]),
      myUserId: 'me',
      lastMessage: null,
    });

    expect(row.preview).toBe('');
  });
});

describe('describeMessage', () => {
  it('decides "mine" by sender id, never by position', () => {
    const message: MessageResponse = {
      id: 'm1',
      conversationId: 'conv-1',
      senderUserId: 'me',
      messageType: 'TEXT',
      body: '好的',
      moderationStatus: 'APPROVED',
      createdAt: '2026-10-30T14:05:00.000Z',
    };

    expect(describeMessage(message, 'me').mine).toBe(true);
    expect(describeMessage(message, 'tutor').mine).toBe(false);
  });
});
