import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  MAX_CONTENT_REF_LENGTH,
  MAX_RULE_TYPE_LENGTH,
  MAX_RULE_VERSION_LENGTH,
} from '../../domain/platform-policy';

/** `PATCH /admin/feature-flags/:key`. */
export class SetFeatureFlagDto {
  // No coercion: a switch is either on or off, anything else is refused.
  @IsBoolean()
  readonly enabled!: boolean;
}

/** `POST /admin/platform-rules`. */
export class CreatePlatformRuleDto {
  @IsString()
  @MaxLength(MAX_RULE_TYPE_LENGTH)
  readonly ruleType!: string;

  @IsString()
  @MaxLength(MAX_RULE_VERSION_LENGTH)
  readonly version!: string;

  @IsString()
  @MaxLength(MAX_CONTENT_REF_LENGTH)
  readonly contentRef!: string;

  @IsOptional()
  @IsISO8601()
  readonly effectiveAt?: string;
}
