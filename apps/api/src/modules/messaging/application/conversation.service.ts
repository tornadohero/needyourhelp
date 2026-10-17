import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { AnalyticsService } from '../../analytics/application/analytics.service';

import type { ReportReasonCodeName } from '@mentor/api-contracts';

import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { PROVIDER_DIRECTORY } from '../../discovery/domain/provider-directory';
import type { ProviderDirectory } from '../../discovery/domain/provider-directory';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { providerNotFound } from '../../provider/domain/provider.errors';
import { ACTIVE_MODERATION_STATUSES } from '../../moderation/domain/moderation-policy';
import {
  assertPage,
  assertPageSize,
  assertPeer,
  assertReportDescription,
} from '../domain/conversation-policy';
import { CONVERSATION_REPOSITORY } from '../domain/conversation.repository';
import type { ConversationRepository } from '../domain/conversation.repository';
import type { Conversation, ConversationMemberRole } from '../domain/conversation.model';
import {
  blockedUser,
  conversationForbidden,
  conversationNotFound,
  messagingInvalidState,
} from '../domain/messaging.errors';
import { MESSAGING_GATEWAY } from '../domain/messaging-gateway';
import type { MessagingGateway } from '../domain/messaging-gateway';
import { MODERATION_REPOSITORY } from '../../moderation/domain/moderation.repository';
import type { ModerationRepository } from '../../moderation/domain/moderation.repository';
import { BLOCK_REPOSITORY } from '../domain/block.repository';
import type { BlockRepository } from '../domain/block.repository';

export interface CreateConversationCommand {
  peerUserId: string;
  /** Optional: the provider the conversation is about (a provider inquiry). */
  providerId?: string | null;
}

/**
 * Conversations (`specs/05-api-spec.md` §Messaging, `specs/09-im-spec.md`).
 *
 * The platform creates the conversation reference and asks the IM adapter for
 * the transport; message content never touches our database
 * (`specs/09` §Message policy). Every gate the spec lists is checked here:
 * both accounts active, no block in either direction, and a provider target that
 * is discoverable.
 */
@Injectable()
export class ConversationService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(BLOCK_REPOSITORY) private readonly blocks: BlockRepository,
    @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepository,
    @Inject(MESSAGING_GATEWAY) private readonly gateway: MessagingGateway,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PROVIDER_DIRECTORY) private readonly directory: ProviderDirectory,
    // Analytics is a side effect, never a dependency (T020).
    @Optional() @Inject(AnalyticsService) private readonly analytics?: AnalyticsService,
  ) {}

  /** `POST /conversations`. */
  async create(userId: string, command: CreateConversationCommand): Promise<Conversation> {
    assertPeer(userId, command.peerUserId);
    await this.assertActive(userId, 'Your account is not active.');
    await this.assertActive(command.peerUserId, 'The other account is not active.');

    // A block in either direction stops new conversations (`specs/09` §Safety).
    if (await this.blocks.existsBetween(userId, command.peerUserId)) {
      throw blockedUser();
    }

    // "target provider/service is discoverable" (`specs/09` §Conversation
    // creation): an unknown or hidden provider is simply not found.
    let providerOwnerId: string | null = null;
    let domain: Conversation['domain'] = 'TUTORING';
    if (command.providerId) {
      if (!isUuid(command.providerId)) {
        throw providerNotFound();
      }
      const detail = await this.directory.findDiscoverable(command.providerId);
      if (!detail) {
        throw providerNotFound();
      }
      providerOwnerId = detail.provider.userId;
      domain = detail.provider.providerType;
      if (providerOwnerId !== userId && providerOwnerId !== command.peerUserId) {
        throw conversationForbidden('The provider is not part of this conversation.');
      }
    }

    const members: { userId: string; role: ConversationMemberRole }[] =
      providerOwnerId === null
        ? [
            { userId, role: 'BUYER' },
            { userId: command.peerUserId, role: 'BUYER' },
          ]
        : [
            { userId: providerOwnerId, role: 'PROVIDER' },
            {
              userId: providerOwnerId === userId ? command.peerUserId : userId,
              role: 'BUYER',
            },
          ];

    // The transport is asked first: either there is a conversation with a
    // transport, or nothing is written at all.
    const conversationId = randomUUID();
    const ref = await this.gateway.createConversation({
      conversationId,
      memberUserIds: members.map((member) => member.userId),
      domain,
    });

    const conversation = await this.conversations.create({
      id: conversationId,
      domain,
      providerConversationId: ref.providerConversationId,
      members,
    });

    await this.analytics?.track({
      name: 'chat_started',
      actorUserId: userId,
      providerId: command.providerId ?? null,
      conversationId: conversation.id,
      props: {},
    });
    // A conversation opened about a provider is an inquiry for that provider.
    if (command.providerId) {
      await this.analytics?.track({
        name: 'inquiry_received',
        providerId: command.providerId,
        conversationId: conversation.id,
        props: {},
      });
    }

    return conversation;
  }

  /** `GET /conversations`: own conversations, newest first, always bounded. */
  async listMine(userId: string, options: { page?: number; pageSize?: number } = {}) {
    const page = assertPage(options.page);
    const pageSize = assertPageSize(options.pageSize);
    const result = await this.conversations.listByUser(userId, { page, pageSize });
    return { ...result, page, pageSize };
  }

  /** `GET /conversations/:id`: members only, and never a hidden conversation. */
  async getForMember(userId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.requireMember(userId, conversationId);
    return conversation;
  }

  /**
   * A server-side system message (`specs/09` §System messages).
   *
   * The transport carries it; the platform stores no content. A frozen
   * conversation (blocked or closed) accepts nothing.
   */
  async sendSystemMessage(input: {
    conversationId: string;
    templateCode: string;
    params?: Record<string, unknown>;
  }): Promise<void> {
    const conversation = await this.conversations.findById(input.conversationId);
    if (!conversation) {
      throw conversationNotFound();
    }
    if (conversation.status !== 'OPEN') {
      throw messagingInvalidState(
        `A conversation in status ${conversation.status} cannot carry messages.`,
      );
    }
    if (!conversation.providerConversationId) {
      throw messagingInvalidState('This conversation has no transport assigned.');
    }

    await this.gateway.sendSystemMessage({
      conversationId: conversation.id,
      providerConversationId: conversation.providerConversationId,
      templateCode: input.templateCode,
      params: input.params,
    });
  }

  /**
   * `POST /conversations/:id/report`: an abuse report always creates a
   * moderation case (`specs/09` §Safety), at most one active case per target.
   */
  async reportConversation(
    userId: string,
    conversationId: string,
    input: { reasonCode: ReportReasonCodeName; description?: string | null },
  ) {
    const conversation = await this.requireMember(userId, conversationId);
    const description = assertReportDescription(input.description);

    const result = await this.moderation.createReportWithCase(
      {
        reporterUserId: userId,
        targetType: 'CONVERSATION',
        targetId: conversation.id,
        reasonCode: input.reasonCode,
        description,
      },
      ACTIVE_MODERATION_STATUSES,
    );

    return {
      reportId: result.report.id,
      caseId: result.moderationCase.id,
      reasonCode: input.reasonCode,
      caseCreated: result.caseCreated,
    };
  }

  /**
   * Membership is the only read permission, and a non-member gets `NOT_FOUND`
   * so a conversation id cannot be probed (`specs/13-security-spec.md`).
   */
  private async requireMember(userId: string, conversationId: string): Promise<Conversation> {
    if (!isUuid(conversationId)) {
      throw conversationNotFound();
    }
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) {
      throw conversationNotFound();
    }
    if (!conversation.members.some((member) => member.userId === userId)) {
      throw conversationNotFound();
    }
    return conversation;
  }

  private async assertActive(userId: string, message: string): Promise<void> {
    if (!isUuid(userId)) {
      throw messagingInvalidState(message);
    }
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      throw messagingInvalidState(message);
    }
  }
}
