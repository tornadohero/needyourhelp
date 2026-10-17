import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

import { PROVIDER_TYPES, type ProviderTypeName } from '@mentor/api-contracts';

import { MAX_RECURRENCE_RULE_LENGTH } from '../../domain/availability-policy';

/**
 * `POST /providers/me/availability`.
 *
 * There is deliberately no `providerId` or `status`: the owner comes from the
 * session and a new slot is always `OPEN` (`AGENTS.md` §7). The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so any extra property is
 * rejected.
 */
export class CreateAvailabilitySlotDto {
  /** ISO-8601; UTC in the database, displayed in the user timezone. */
  @IsISO8601({ strict: true })
  readonly startAt!: string;

  @IsISO8601({ strict: true })
  readonly endAt!: string;

  /** Stored verbatim; never expanded in V1 (`specs/00-product-spec.md` §V1.1). */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RECURRENCE_RULE_LENGTH)
  readonly recurrenceRule?: string;
}

/** `?providerType=TUTORING`, mirroring the other provider routes. */
export class ProviderAvailabilityQueryDto {
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly providerType?: ProviderTypeName;
}
