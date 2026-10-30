import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import type {
  ConversationListResponse,
  ConversationReportResponse,
  ConversationResponse,
  MessageListResponse,
  MessageResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { ConversationService } from '../application/conversation.service';
import {
  toConversationListResponse,
  withMemberDisplayNames,
  toConversationReportResponse,
  toConversationResponse,
  toMessageListResponse,
  toMessageResponse,
} from './messaging.mapper';
import { translate } from './messaging-error-translator';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ConversationListQueryDto,
  CreateConversationDto,
  MessageListQueryDto,
  ReportConversationDto,
  SendMessageDto,
} from './dto/messaging.dto';

/**
 * Conversation endpoints (`specs/05-api-spec.md` §Messaging).
 *
 * The controller authenticates, validates, invokes the use case and maps the
 * response (`AGENTS.md` §6): every gate lives in the domain, and no route can
 * read or write a conversation the caller is not part of.
 */
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(@Inject(ConversationService) private readonly conversations: ConversationService) {}

  /** `POST /conversations`. */
  @RateLimit('conversations.create')
  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateConversationDto,
  ): Promise<ConversationResponse> {
    return translate(async () => {
      const conversation = await this.conversations.create(principal.userId, {
        peerUserId: body.peerUserId,
        providerId: body.providerId ?? null,
      });
      return toConversationResponse(conversation);
    });
  }

  /** `GET /conversations`: own conversations, newest first, bounded. */
  @Get()
  async list(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ConversationListQueryDto,
  ): Promise<ConversationListResponse> {
    return translate(async () => {
      const result = await this.conversations.listMine(principal.userId, {
        page: query.page,
        pageSize: query.pageSize,
      });
      const response = toConversationListResponse(result);
      const names = await this.conversations.displayNames(
        response.items.flatMap((conversation) => conversation.members.map((m) => m.userId)),
      );
      return { ...response, items: response.items.map((c) => withMemberDisplayNames(c, names)) };
    });
  }

  /** `GET /conversations/:id`: members only. */
  @Get(':id')
  async detail(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ConversationResponse> {
    return translate(async () => {
      const response = toConversationResponse(
        await this.conversations.getForMember(principal.userId, id),
      );
      const names = await this.conversations.displayNames(
        response.members.map((member) => member.userId),
      );
      return withMemberDisplayNames(response, names);
    });
  }

  /** `POST /conversations/:id/messages`: members only, never a blocked pair. */
  @Post(':id/messages')
  @RateLimit('messages.send')
  async sendMessage(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ): Promise<MessageResponse> {
    return translate(async () => {
      // A client never sends a system message: that type is server-side only.
      const messageType = body.messageType === 'SYSTEM' ? 'TEXT' : (body.messageType ?? 'TEXT');

      const sent = await this.conversations.sendMessage(principal.userId, id, {
        body: body.body,
        messageType,
      });

      return toMessageResponse({
        id: sent.reference.id,
        conversationId: sent.reference.conversationId,
        senderUserId: sent.reference.senderUserId,
        messageType,
        body: sent.body,
        moderationStatus: sent.reference.moderationStatus,
        createdAt: sent.reference.createdAt,
      });
    });
  }

  /** `GET /conversations/:id/messages`: the thread the transport holds. */
  @Get(':id/messages')
  async listMessages(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: MessageListQueryDto,
  ): Promise<MessageListResponse> {
    return translate(async () => {
      const { items } = await this.conversations.listMessages(principal.userId, id, {
        limit: query.limit,
      });

      return toMessageListResponse(
        items.map((message) =>
          toMessageResponse({
            id: message.externalMessageId,
            conversationId: id,
            senderUserId: message.senderUserId,
            messageType: message.messageType,
            body: message.body,
            moderationStatus: 'PENDING',
            createdAt: message.createdAt,
          }),
        ),
      );
    });
  }

  /** `POST /conversations/:id/report`: creates a moderation case. */
  @Post(':id/report')
  async report(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: ReportConversationDto,
  ): Promise<ConversationReportResponse> {
    return translate(async () => {
      const result = await this.conversations.reportConversation(principal.userId, id, {
        reasonCode: body.reasonCode,
        description: body.description ?? null,
      });
      return toConversationReportResponse(result);
    });
  }
}
