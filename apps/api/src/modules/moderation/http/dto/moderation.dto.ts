import {
  MODERATION_ACTIONS,
  MODERATION_CASE_STATUSES,
  MODERATION_TARGET_TYPES,
  REPORT_REASON_CODES,
  type ModerationActionName,
  type ModerationCaseStatusName,
  type ModerationTargetTypeName,
  type ReportReasonCodeName,
  type ReportStatusName,
} from '@mentor/api-contracts';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import {
  MAX_APPEAL_REASON_LENGTH,
  MAX_QUEUE_PAGE_SIZE,
  MAX_REPORT_DESCRIPTION_LENGTH,
  MAX_RESOLUTION_LENGTH,
} from '../../domain/moderation-policy';

/** `POST /reports`. */
export class CreateReportDto {
  @IsEnum(MODERATION_TARGET_TYPES)
  readonly targetType!: ModerationTargetTypeName;

  @IsUUID()
  readonly targetId!: string;

  @IsEnum(REPORT_REASON_CODES)
  readonly reasonCode!: ReportReasonCodeName;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REPORT_DESCRIPTION_LENGTH)
  readonly description?: string;
}

/** `GET /me/reports` and `GET /admin/reports`. */
export class ReportListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUEUE_PAGE_SIZE)
  readonly pageSize?: number;

  @IsOptional()
  @IsEnum(MODERATION_CASE_STATUSES)
  readonly status?: ModerationCaseStatusName;
}

/** `POST /admin/reports/:id/resolve`. */
export class ResolveReportDto {
  @IsString()
  @MaxLength(MAX_RESOLUTION_LENGTH)
  readonly resolution!: string;

  @IsOptional()
  @IsEnum(['RESOLVED', 'DISMISSED'])
  readonly outcome?: Extract<ReportStatusName, 'RESOLVED' | 'DISMISSED'>;

  @IsOptional()
  @IsEnum(MODERATION_ACTIONS)
  readonly action?: ModerationActionName;

  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  readonly severity?: string | null;
}

/** `POST /admin/moderation/:id/transition`. */
export class TransitionCaseDto {
  @IsEnum(['INVESTIGATING', 'ACTION_REQUIRED'])
  readonly status!: Extract<ModerationCaseStatusName, 'INVESTIGATING' | 'ACTION_REQUIRED'>;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESOLUTION_LENGTH)
  readonly note?: string;
}

/** `POST /admin/moderation/:id/finalize`: the decision that closes an appeal. */
export class FinalizeCaseDto {
  @IsString()
  @MaxLength(MAX_RESOLUTION_LENGTH)
  readonly decision!: string;

  @IsString()
  @MaxLength(MAX_RESOLUTION_LENGTH)
  readonly decisionReason!: string;
}

/** `POST /reports/:id/appeal`. */
export class AppealDto {
  @IsString()
  @MaxLength(MAX_APPEAL_REASON_LENGTH)
  readonly reason!: string;
}
