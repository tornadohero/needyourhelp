import type { ConversationResponse, MessageResponse } from '@mentor/api-contracts';

/**
 * The messages tab and the chat screen see view models, never the raw
 * conversation aggregate (`specs/09-im-spec.md`): a row shows who, what and
 * when — a thread shows bubbles — and nothing here can carry a field the
 * member list should not expose.
 */

/** One row of the messages tab. */
export interface ConversationRowView {
  id: string;
  /** The other side's name; falls back to their role when they have none. */
  title: string;
  /** Last message, cut to one line; empty when the thread has no words yet. */
  preview: string;
  timeText: string;
  /** A thread tied to an order is about that booking, not small talk. */
  orderLinked: boolean;
}

/** One bubble in the chat screen. */
export interface MessageView {
  id: string;
  mine: boolean;
  body: string;
  timeText: string;
}

const DAY_MS = 24 * 60 * 60_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * A list timestamp answers "when was this" at a glance, the way every chat app
 * the user already knows does: today shows the clock, yesterday says so, this
 * week names the day, and anything older gets a date.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return '';
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const date = `${at.getMonth() + 1}月${at.getDate()}日`;
  const daysAgo = Math.floor(
    (startOfToday - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / DAY_MS,
  );

  if (at.getTime() >= startOfToday) {
    return clock;
  }
  if (daysAgo === 1) {
    return `昨天 ${clock}`;
  }
  if (daysAgo < 7) {
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][at.getDay()] ?? date;
    return week;
  }
  if (at.getFullYear() === now.getFullYear()) {
    return date;
  }
  return `${at.getFullYear()}年${date}`;
}

/**
 * The member on the other side of the thread.
 *
 * The list is "mine", so the counterpart is simply the member who is not me;
 * their `displayName` is what the server joined in, and a missing name degrades
 * to the role rather than an invented one.
 */
export function counterpartOf(
  conversation: ConversationResponse,
  myUserId: string,
): { userId: string; name: string } {
  const other = conversation.members.find((member) => member.userId !== myUserId);
  const roleText = other?.role === 'PROVIDER' ? '导师' : other?.role === 'SYSTEM' ? '系统' : '家长';

  return {
    userId: other?.userId ?? '',
    name: other?.displayName?.trim() ? other.displayName : roleText,
  };
}

/** Build the messages-tab row for one conversation. */
export function describeConversation(input: {
  conversation: ConversationResponse;
  myUserId: string;
  lastMessage: MessageResponse | null;
}): ConversationRowView {
  const { conversation, myUserId, lastMessage } = input;
  const other = counterpartOf(conversation, myUserId);

  return {
    id: conversation.id,
    title: other.name,
    preview: lastMessage?.body ?? '',
    timeText: lastMessage ? relativeTime(lastMessage.createdAt) : '',
    orderLinked: conversation.orderId !== null,
  };
}

/** Build one chat bubble; "mine" is decided by sender id, never by order. */
export function describeMessage(message: MessageResponse, myUserId: string): MessageView {
  return {
    id: message.id,
    mine: message.senderUserId === myUserId,
    body: message.body,
    timeText: relativeTime(message.createdAt),
  };
}
