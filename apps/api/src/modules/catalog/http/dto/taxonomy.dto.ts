import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { TAXONOMY_TYPES, type TaxonomyTypeName } from '@mentor/api-contracts';

/** `GET /admin/taxonomy` (`specs/05-api-spec.md` §Taxonomy). */
export class TaxonomyListQueryDto {
  @IsOptional()
  @IsEnum(TAXONOMY_TYPES)
  readonly type?: TaxonomyTypeName;

  @IsOptional()
  @IsUUID()
  readonly parentId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  readonly active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  /** A page is always bounded: the listing never scans the whole table. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}

/**
 * `POST /admin/taxonomy`.
 *
 * There is deliberately no `active`, `id` or `type`-changing field beyond the
 * ones below: the server owns them (`AGENTS.md` §7), and the global
 * `ValidationPipe` runs with `forbidNonWhitelisted`.
 */
export class CreateTaxonomyTermDto {
  @IsEnum(TAXONOMY_TYPES)
  readonly type!: TaxonomyTypeName;

  /** Case-insensitive on input; stored uppercase (see `taxonomy-policy`). */
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_]{1,64}$/)
  readonly code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly name!: string;

  @IsOptional()
  @IsUUID()
  readonly parentId?: string | null;
}

/**
 * `PATCH /admin/taxonomy/:id`.
 *
 * `code` is absent on purpose: it is the stable key referenced by compliance
 * restrictions and order snapshots, so it never changes after creation.
 * `active` is the only recovery path from an archive, because the spec defines
 * no restore endpoint.
 */
export class UpdateTaxonomyTermDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly name?: string;

  @IsOptional()
  @IsUUID()
  readonly parentId?: string | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  readonly active?: boolean;
}
