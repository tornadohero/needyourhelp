import type {
  BlockResponse,
  ConversationListResponse,
  ConversationMemberResponse,
  ConversationResponse,
  ConversationReportResponse,
  MessageReferenceResponse,
  UnblockResponse,
} from '@mentor/api-contracts';

import type { BlockRecord } from '../domain/block.repository';
import type { Conversation, MessageReference } from '../domain/conversation.model';

/**
 * Response mappers for messaging.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). Nothing here can carry message content: the platform never
 * stores it (`specs/09-im-spec.md` §Message policy), and no contact detail is
 * ever exposed (`specs/09` §Message policy, `specs/01-business-rules.md`
 * §Communication).
 */
export function toConversationMemberResponse(member: {
  userId: string;
  role: ConversationMemberResponse['role'];
}): ConversationMemberResponse {
  return { userId: member.userId, role: member.role };
}

export function toMessageReferenceResponse(reference: MessageReference): MessageReferenceResponse {
  return {
    id: reference.id,
    messageType: reference.messageType,
    senderUserId: reference.senderUserId,
    moderationStatus: reference.moderationStatus,
    createdAt: reference.createdAt.toISOString(),
  };
}

export function toConversationResponse(conversation: Conversation): ConversationResponse {
  return {
    id: conversation.id,
    domain: conversation.domain,
    orderId: conversation.orderId,
    status: conversation.status,
    members: conversation.members.map(toConversationMemberResponse),
    // References only: empty until the chosen IM design requires persistence.
    messages: conversation.messages.map(toMessageReferenceResponse),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toConversationListResponse(result: {
  items: Conversation[];
  total: number;
  page: number;
  pageSize: number;
}): ConversationListResponse {
  return {
    items: result.items.map(toConversationResponse),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

export function toBlockResponse(record: BlockRecord): BlockResponse {
  return {
    blockedUserId: record.blockedUserId,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toUnblockResponse(blockedUserId: string): UnblockResponse {
  return { blockedUserId, blocked: false };
}

export function toConversationReportResponse(result: {
  reportId: string;
  caseId: string;
  reasonCode: ConversationReportResponse['reasonCode'];
  caseCreated: boolean;
}): ConversationReportResponse {
  return {
    reportId: result.reportId,
    caseId: result.caseId,
    reasonCode: result.reasonCode,
    caseCreated: result.caseCreated,
  };
}
