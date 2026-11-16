import { describe, expect, it } from 'vitest';

import { ApiClient } from '../core/http';
import type { Transport, TransportRequest } from '../core/http';
import { MemoryTokenStore, SessionManager } from '../core/session';
import { openConversationWithProvider } from './chat';

type Answer = { status: number; body: unknown };

function harness(answers: Answer[] = []) {
  const calls: TransportRequest[] = [];
  const queue = [...answers];

  const transport: Transport = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) {
      throw new Error('no answer queued');
    }
    return next;
  };

  const client = new ApiClient({ origin: 'https://api.example.com', transport });
  const store = new MemoryTokenStore();
  const session = new SessionManager({ client, store });
  store.set({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 4_102_444_800 });

  return { context: { client, session }, calls };
}

const CONVERSATION = {
  id: 'conversation-1',
  domain: 'TUTORING',
  orderId: null,
  status: 'OPEN',
  members: [
    { userId: 'me', role: 'BUYER', displayName: '家长' },
    { userId: 'tutor', role: 'PROVIDER', displayName: '李老师' },
  ],
  messages: [],
  createdAt: '2026-10-30T09:00:00.000Z',
  updatedAt: '2026-10-30T09:00:00.000Z',
};

describe('openConversationWithProvider', () => {
  it('names only the provider — never the owner user id', async () => {
    const { context, calls } = harness([{ status: 200, body: { data: CONVERSATION } }]);

    const id = await openConversationWithProvider(context, 'provider-1');

    expect(id).toBe('conversation-1');
    expect(calls[0]?.url).toBe('https://api.example.com/api/v1/conversations/with-provider');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.Authorization).toBe('Bearer access-1');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ providerId: 'provider-1' });
    expect(String(calls[0]?.body)).not.toContain('peerUserId');
  });

  it('returns the conversation the server answered, even when it reused one', async () => {
    const { context } = harness([
      { status: 200, body: { data: { ...CONVERSATION, id: 'existing-thread' } } },
    ]);

    expect(await openConversationWithProvider(context, 'provider-1')).toBe('existing-thread');
  });
});
