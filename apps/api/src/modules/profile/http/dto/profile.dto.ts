import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CONSENT_TYPES, type ConsentTypeName } from '@mentor/api-contracts';

/**
 * `PUT /me/profile` body.
 *
 * There is deliberately no `userId`, `role` or status field: the subject comes
 * from the access token and only display fields may change (`AGENTS.md` §7).
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so any extra
 * property is rejected.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  readonly avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/)
  readonly cityCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly timezone?: string;
}

/**
 * `POST /me/children` body.
 *
 * No `guardianUserId`: the guardian is the authenticated account
 * (`specs/07-permission-spec.md` — "Parent can CRUD own children").
 */
export class CreateChildDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly nickname!: string;

  @IsOptional()
  @IsInt()
  @Min(1970)
  @Max(2100)
  readonly birthYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  readonly gradeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  readonly schoolName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly learningGoals?: string;

  /**
   * Explicit guardian consent, captured with the child profile (AT-020).
   * Omitting it requires an existing active `MINOR_GUARDIAN` consent.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  readonly consentPolicyVersion?: string;
}

/** `PATCH /me/children/:id` body. */
export class UpdateChildDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly nickname?: string;

  @IsOptional()
  @IsInt()
  @Min(1970)
  @Max(2100)
  readonly birthYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  readonly gradeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  readonly schoolName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly learningGoals?: string;
}

/** `POST /me/consents` body. */
export class GrantConsentDto {
  @IsEnum(CONSENT_TYPES)
  readonly consentType!: ConsentTypeName;

  /** Version of the policy being accepted; recorded verbatim. */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  readonly policyVersion!: string;

  /** Consent must be an explicit act: `false` is rejected. */
  @IsOptional()
  @IsBoolean()
  readonly granted?: boolean;
}
