import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import {
  CAPABILITY_TYPES,
  DELIVERY_MODES,
  PROVIDER_SORTS,
  PROVIDER_TYPES,
  type CapabilityTypeName,
  type DeliveryModeName,
  type ProviderSortName,
  type ProviderTypeName,
} from '@mentor/api-contracts';

import { MAX_PAGE_SIZE, MAX_PRICE_FILTER_MINOR } from '../../domain/discovery-policy';

/** Taxonomy codes as a caller may type them; the server upper-cases them. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

/**
 * `GET /providers` (`specs/05-api-spec.md` §Provider).
 *
 * Every filter is optional and server-validated; there is deliberately no way to
 * ask for a provider that is not discoverable, and no filter exposes a private
 * field (`specs/07-permission-spec.md`, `specs/10-privacy-and-minors.md`).
 */
export class ProviderSearchQueryDto {
  /** The marketplace: `provider_profiles.provider_type`. */
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  readonly domain?: ProviderTypeName;

  /** Kind of provider: `provider_capabilities.capability_type`. */
  @IsOptional()
  @IsEnum(CAPABILITY_TYPES)
  readonly providerType?: CapabilityTypeName;

  @IsOptional()
  @IsString()
  @Matches(CODE_PATTERN)
  readonly city?: string;

  @IsOptional()
  @IsString()
  @Matches(CODE_PATTERN)
  readonly subject?: string;

  @IsOptional()
  @IsString()
  @Matches(CODE_PATTERN)
  readonly grade?: string;

  @IsOptional()
  @IsEnum(DELIVERY_MODES)
  readonly deliveryMode?: DeliveryModeName;

  /** Minor units, like every money value in the API (`AGENTS.md` §8). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_FILTER_MINOR)
  readonly minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_FILTER_MINOR)
  readonly maxPrice?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  readonly verifiedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  /** A public listing is always bounded: it never scans the whole table. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly pageSize?: number;

  @IsOptional()
  @IsEnum(PROVIDER_SORTS)
  readonly sort?: ProviderSortName;
}
