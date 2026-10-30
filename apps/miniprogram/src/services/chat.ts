import type { MentorContext } from '../app-context';
import { currentUser } from './auth';
import { counterpartOf, describeConversation, describeMessage } from '../core/chat-view';
import type { ConversationRowView, MessageView } from '../core/chat-view';
import { ROUTES, fillPath } from '../core/routes';
import type {
  ConversationListResponse,
  ConversationResponse,
  MessageListResponse,
  MessageResponse,
} from '@mentor/api-contracts';

/**
 * Chat use cases (消息 tab) — the read and write side of "talk to the other
 * side of a booking".
 *
 * The platform stores references only; bodies come back from the transport
 * through the API (`specs/09-im-spec.md`). The list needs one extra hop per
 * thread to learn its last words — the list response carries references, not
 * content — which is fine at a person's scale of conversations.
 */

/** The message list page, one row per thread, newest thread first. */
export async function listConversations(context: MentorContext): Promise<ConversationRowView[]> {
  const me = await currentUser(context);

  return context.session.withSession(async (accessToken) => {
    const page = await context.client.get<ConversationListResponse>(ROUTES.conversations, {
      accessToken,
      query: { page: 1, pageSize: 20 },
    });

    const rows = await Promise.all(
      page.items.map(async (conversation) => {
        const last = await lastMessage(context, conversation.id, accessToken);
        return describeConversation({ conversation, myUserId: me.id, lastMessage: last });
      }),
    );

    // The server orders by `updatedAt`; a thread whose last words just came in
    // stays on top, which is what the eye expects.
    return rows;
  });
}

/** The last message of a thread, or `null` when it has none yet. */
async function lastMessage(
  context: MentorContext,
  conversationId: string,
  accessToken: string,
): Promise<MessageResponse | null> {
  const page = await context.client.get<MessageListResponse>(
    fillPath(ROUTES.conversationMessages, { id: conversationId }),
    { accessToken, query: { limit: 1 } },
  );
  return page.items[page.items.length - 1] ?? null;
}

/** The full thread, oldest first, ready to render as bubbles. */
export async function loadThread(
  context: MentorContext,
  conversationId: string,
): Promise<{ title: string; messages: MessageView[] }> {
  const me = await currentUser(context);

  return context.session.withSession(async (accessToken) => {
    const conversation = await context.client.get<ConversationResponse>(
      fillPath(ROUTES.conversationDetail, { id: conversationId }),
      { accessToken },
    );
    const page = await context.client.get<MessageListResponse>(
      fillPath(ROUTES.conversationMessages, { id: conversationId }),
      { accessToken, query: { limit: 50 } },
    );

    return {
      title: counterpartOf(conversation, me.id).name,
      messages: page.items.map((message) => describeMessage(message, me.id)),
    };
  });
}

/**
 * Send one message.
 *
 * The body is trimmed here: a note of spaces is not a message, and an empty
 * send is refused before it costs a round trip.
 */
export async function sendMessage(
  context: MentorContext,
  conversationId: string,
  body: string,
): Promise<MessageView> {
  const me = await currentUser(context);
  const text = body.trim();
  if (text.length === 0) {
    throw new Error('EMPTY_MESSAGE');
  }

  return context.session.withSession(async (accessToken) => {
    const sent = await context.client.post<MessageResponse>(
      fillPath(ROUTES.conversationMessages, { id: conversationId }),
      { accessToken, body: { body: text } },
    );
    return describeMessage(sent, me.id);
  });
}
