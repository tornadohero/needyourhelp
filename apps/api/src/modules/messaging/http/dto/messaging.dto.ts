import { MESSAGE_TYPES, type MessageTypeName } from '@mentor/api-contracts';

import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { REPORT_REASON_CODES, type ReportReasonCodeName } from '@mentor/api-contracts';

import { MAX_REPORT_DESCRIPTION_LENGTH } from '../../../moderation/domain/moderation-policy';
import {
  MAX_MESSAGE_BODY_LENGTH,
  MAX_MESSAGE_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../domain/conversation-policy';

/**
 * `POST /conversations`.
 *
 * There is deliberately no `status`, `domain` or member list: the server decides
 * all three (`AGENTS.md` §7), and the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so any extra property is rejected.
 */
export class CreateConversationDto {
  @IsUUID()
  readonly peerUserId!: string;

  /** Optional: the provider the conversation is about. */
  @IsOptional()
  @IsUUID()
  readonly providerId?: string;
}

/** `GET /conversations`. */
export class ConversationListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  /** A listing is always bounded (`specs/05-api-spec.md` defines no paging). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly pageSize?: number;
}

/**
 * `POST /conversations/:id/report`.
 *
 * The reason is one of the moderation categories of
 * `specs/12-admin-spec.md` §Moderation, never free text.
 */
export class ReportConversationDto {
  @IsEnum(REPORT_REASON_CODES)
  readonly reasonCode!: ReportReasonCodeName;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPORT_DESCRIPTION_LENGTH)
  readonly description?: string;
}

/**
 * `POST /conversations/:id/messages` (T028 gap G4).
 *
 * No `senderUserId`, no `conversationId`, no `status`: identity comes from the
 * session and moderation state is decided server-side (`AGENTS.md` §7).
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_BODY_LENGTH)
  readonly body!: string;

  @IsOptional()
  @IsEnum(MESSAGE_TYPES)
  readonly messageType?: MessageTypeName;
}

/** `GET /conversations/:id/messages`. */
export class MessageListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGE_PAGE_SIZE)
  readonly limit?: number;
}
