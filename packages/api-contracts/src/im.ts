/**
 * Messaging contract (T012).
 *
 * Source of truth: `specs/09-im-spec.md`, `specs/03-architecture-spec.md`
 * (external provider ports), `specs/05-api-spec.md` §Messaging,
 * `specs/04-database-spec.md` (§conversations, §conversation_members,
 * §message_refs, §blocks, §reports, §moderation_cases).
 *
 * The platform never stores message content and never exposes contact details:
 * a conversation is a reference to a transport owned by the IM adapter
 * (`specs/09-im-spec.md` §Goal, §Message policy).
 */

import type { ReportReasonCodeName } from './moderation';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `conversations.status`. A blocked pair freezes the conversation. */
export const CONVERSATION_STATUSES = ['OPEN', 'BLOCKED', 'CLOSED'] as const;
export type ConversationStatusName = (typeof CONVERSATION_STATUSES)[number];

/** `conversation_members.role`. */
export const CONVERSATION_ROLES = ['BUYER', 'PROVIDER', 'SYSTEM'] as const;
export type ConversationRoleName = (typeof CONVERSATION_ROLES)[number];

/** `message_refs.message_type`. */
export const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'SYSTEM'] as const;
export type MessageTypeName = (typeof MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface ConversationMemberResponse {
  userId: string;
  role: ConversationRoleName;
}

/**
 * `message_refs` — a reference, never the content.
 *
 * Empty until the selected IM design requires persistence
 * (`specs/04-database-spec.md` §message_refs).
 */
export interface MessageReferenceResponse {
  id: string;
  messageType: MessageTypeName;
  senderUserId: string;
  moderationStatus: string;
  createdAt: string;
}

export interface ConversationResponse {
  id: string;
  domain: string;
  orderId: string | null;
  status: ConversationStatusName;
  members: ConversationMemberResponse[];
  messages: MessageReferenceResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  items: ConversationResponse[];
  total: number;
  page: number;
  pageSize: number;
}

/** `POST /users/:id/block`. */
export interface BlockResponse {
  blockedUserId: string;
  createdAt: string;
}

/** `DELETE /users/:id/block`. */
export interface UnblockResponse {
  blockedUserId: string;
  blocked: boolean;
}

/**
 * `POST /conversations/:id/report`.
 *
 * A report always ends in a moderation case: `reports` is the intake record,
 * `moderation_cases` owns the workflow (`specs/04-database-spec.md`).
 */
export interface ConversationReportResponse {
  reportId: string;
  caseId: string;
  reasonCode: ReportReasonCodeName;
  /** `false` when the target already had an active case. */
  caseCreated: boolean;
}

/**
 * `message_refs` plus what the transport holds (T028 gap G4).
 *
 * `specs/09-im-spec.md` keeps the platform free of message content: the transport
 * owns the bytes, the platform owns a reference. A message response therefore
 * carries the platform reference **and** the body the transport returns, so a
 * client can render a thread — and nothing here is persisted by the platform
 * beyond `message_refs`.
 */
export interface MessageResponse {
  id: string;
  conversationId: string;
  senderUserId: string;
  messageType: MessageTypeName;
  body: string;
  moderationStatus: string;
  createdAt: string;
}

export interface MessageListResponse {
  items: MessageResponse[];
}

export const MESSAGE_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type MessageModerationStatusName = (typeof MESSAGE_MODERATION_STATUSES)[number];
