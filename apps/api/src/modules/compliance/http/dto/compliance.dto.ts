import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { COMPLIANCE_STATUSES, type ComplianceStatusName } from '@mentor/api-contracts';

/**
 * `GET /admin/compliance`.
 *
 * The queue is bounded: an admin listing must never scan the whole table.
 */
export class ComplianceQueueQueryDto {
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @ArrayMaxSize(COMPLIANCE_STATUSES.length)
  @ArrayUnique()
  @IsEnum(COMPLIANCE_STATUSES, { each: true })
  readonly status?: ComplianceStatusName[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}

const TAXONOMY_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Scope of a `RESTRICTED` decision (`specs/06` §Teacher compliance:
 * category / location / time).
 *
 * At least one dimension is required, so `RESTRICTED` always means "restricted
 * to something explicit".
 */
export class ComplianceRestrictionDto {
  /** Category: taxonomy codes the teacher may teach. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TAXONOMY_CODE, { each: true })
  readonly allowedSubjectCodes?: string[];

  /** Location: city codes where the service may be delivered. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TAXONOMY_CODE, { each: true })
  readonly allowedCityCodes?: string[];

  /** Time: last instant at which the restriction still permits the service. */
  @IsOptional()
  @IsISO8601()
  readonly allowedUntil?: string;
}

/**
 * Every compliance decision carries a reason code
 * (`specs/06` §Admin decision requirements).
 */
export class ComplianceDecisionDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z0-9_]{2,64}$/)
  readonly reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly notes?: string;
}

/** `POST /admin/compliance/:capabilityId/restrict`. */
export class RestrictComplianceDto extends ComplianceDecisionDto {
  @IsObject()
  readonly restriction!: ComplianceRestrictionDto;
}
