import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  AVATAR_VISIBILITIES,
  CAPABILITY_TYPES,
  DELIVERY_MODES,
  PROVIDER_TYPES,
  type AvatarVisibilityName,
  type CapabilityTypeName,
  type DeliveryModeName,
  type ProviderTypeName,
} from '@mentor/api-contracts';

/**
 * `POST /providers/applications`.
 *
 * There is deliberately no `approvalStatus`, `searchable`, `userId`, role or
 * rating field: those are decided by the server (`AGENTS.md` §7). The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so any extra property is
 * rejected.
 */
export class CreateProviderApplicationDto {
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly providerType?: ProviderTypeName;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly publicName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly bio?: string;

  @IsOptional()
  @IsEnum(AVATAR_VISIBILITIES)
  readonly avatarVisibility?: AvatarVisibilityName;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/)
  readonly cityCode?: string;

  @IsOptional()
  @IsEnum(DELIVERY_MODES)
  readonly serviceMode?: DeliveryModeName;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CAPABILITY_TYPES.length)
  @ArrayUnique()
  @IsEnum(CAPABILITY_TYPES, { each: true })
  readonly capabilityTypes!: CapabilityTypeName[];
}

/** `PATCH /providers/me`. */
export class UpdateProviderProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly publicName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly bio?: string;

  @IsOptional()
  @IsEnum(AVATAR_VISIBILITIES)
  readonly avatarVisibility?: AvatarVisibilityName;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/)
  readonly cityCode?: string;

  @IsOptional()
  @IsEnum(DELIVERY_MODES)
  readonly serviceMode?: DeliveryModeName;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CAPABILITY_TYPES.length)
  @ArrayUnique()
  @IsEnum(CAPABILITY_TYPES, { each: true })
  readonly capabilityTypes?: CapabilityTypeName[];
}

/** `GET /providers/me?providerType=TUTORING`. */
export class ProviderQueryDto {
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly providerType?: ProviderTypeName;
}

/** `POST /admin/providers/:id/approve`. */
export class ApproveProviderDto {
  /** Optional: an approval is the default outcome. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly reason?: string;
}

/** `POST /admin/providers/:id/reject`. */
export class RejectProviderDto {
  /** Required: a rejection must be explained (`specs/06` §Admin decisions). */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  readonly reason!: string;
}

/** `POST /admin/providers/:id/suspend`: a suspension is always explained. */
export class SuspendProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  readonly reason!: string;
}
