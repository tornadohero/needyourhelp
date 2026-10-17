import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { REPORT_REASON_CODES, type ReportReasonCodeName } from '@mentor/api-contracts';

import { MAX_REPORT_DESCRIPTION_LENGTH } from '../../../moderation/domain/moderation-policy';
import { MAX_PAGE_SIZE } from '../../domain/conversation-policy';

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
