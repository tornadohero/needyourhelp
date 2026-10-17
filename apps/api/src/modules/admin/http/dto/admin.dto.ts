import { ORDER_STATUSES, PROVIDER_APPROVAL_STATUSES, USER_STATUSES } from '@mentor/api-contracts';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { MAX_ADMIN_PAGE_SIZE } from '../../domain/admin-policy';

/** `GET /admin/users`. */
export class AdminUserListQueryDto {
  @IsOptional()
  @IsEnum(USER_STATUSES)
  readonly status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ADMIN_PAGE_SIZE)
  readonly pageSize?: number;
}

/** `GET /admin/providers`. */
export class AdminProviderListQueryDto {
  @IsOptional()
  @IsEnum(PROVIDER_APPROVAL_STATUSES)
  readonly approvalStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ADMIN_PAGE_SIZE)
  readonly pageSize?: number;
}

/** `GET /admin/orders`. */
export class AdminOrderListQueryDto {
  @IsOptional()
  @IsEnum(ORDER_STATUSES)
  readonly status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ADMIN_PAGE_SIZE)
  readonly pageSize?: number;
}

/** `GET /admin/audit-logs`. */
export class AdminAuditLogQueryDto {
  @IsOptional()
  @IsString()
  readonly actorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  readonly resourceType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ADMIN_PAGE_SIZE)
  readonly pageSize?: number;
}

/** `POST /admin/users/:id/roles`. */
export class GrantRoleDto {
  @IsString()
  @MaxLength(32)
  readonly role!: string;
}
