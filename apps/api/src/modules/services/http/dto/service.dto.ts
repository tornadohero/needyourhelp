import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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

import {
  DELIVERY_MODES,
  PROVIDER_TYPES,
  type DeliveryModeName,
  type ProviderTypeName,
} from '@mentor/api-contracts';

import {
  MAX_SERVICE_DESCRIPTION_LENGTH,
  MAX_SERVICE_DURATION_MINUTES,
  MAX_SERVICE_PRICE_MINOR,
  MAX_SERVICE_TITLE_LENGTH,
  MAX_TERMS_PER_TYPE,
  MIN_SERVICE_DURATION_MINUTES,
  MIN_SERVICE_PRICE_MINOR,
} from '../../domain/service-policy';

/** Taxonomy codes as a client may type them; the server upper-cases them. */
const TERM_CODE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * `POST /providers/me/services`.
 *
 * There is deliberately no `status`, `domain`, `providerId` or `id`: the server
 * owns them (`AGENTS.md` §7), and the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so any extra property is a `VALIDATION_ERROR`.
 */
export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SERVICE_TITLE_LENGTH)
  readonly title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SERVICE_DESCRIPTION_LENGTH)
  readonly description?: string | null;

  @IsInt()
  @Min(MIN_SERVICE_DURATION_MINUTES)
  @Max(MAX_SERVICE_DURATION_MINUTES)
  readonly durationMinutes!: number;

  /** Integer minor units: a float or a string is never accepted. */
  @IsInt()
  @Min(MIN_SERVICE_PRICE_MINOR)
  @Max(MAX_SERVICE_PRICE_MINOR)
  readonly priceMinor!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  readonly currency?: string;

  @IsOptional()
  @IsEnum(DELIVERY_MODES)
  readonly deliveryMode?: DeliveryModeName;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly subjectCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly gradeCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly skillCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly cityCodes?: string[];
}

/** `PATCH /providers/me/services/:id`: every field is optional. */
export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SERVICE_TITLE_LENGTH)
  readonly title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SERVICE_DESCRIPTION_LENGTH)
  readonly description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MIN_SERVICE_DURATION_MINUTES)
  @Max(MAX_SERVICE_DURATION_MINUTES)
  readonly durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_SERVICE_PRICE_MINOR)
  @Max(MAX_SERVICE_PRICE_MINOR)
  readonly priceMinor?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  readonly currency?: string;

  @IsOptional()
  @IsEnum(DELIVERY_MODES)
  readonly deliveryMode?: DeliveryModeName;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly subjectCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly gradeCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly skillCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TERMS_PER_TYPE)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(TERM_CODE_PATTERN, { each: true })
  readonly cityCodes?: string[];
}

/** `?providerType=TUTORING`, mirroring the other provider routes. */
export class ProviderServicesQueryDto {
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly providerType?: ProviderTypeName;
}
