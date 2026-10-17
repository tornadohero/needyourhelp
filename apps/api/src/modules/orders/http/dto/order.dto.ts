import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MAX_NOTE_LENGTH, MAX_PAGE_SIZE } from '../../domain/order-policy';

/**
 * `POST /orders`.
 *
 * There is deliberately no price, fee, amount, status or provider: the server
 * derives all of them (`specs/05-api-spec.md` §Orders: "Server derives price").
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so a client that
 * sends `amountMinor` is rejected with `VALIDATION_ERROR`.
 */
export class CreateOrderDto {
  @IsUUID()
  readonly serviceId!: string;

  @IsOptional()
  @IsUUID()
  readonly childId?: string | null;

  @IsISO8601({ strict: true })
  readonly scheduledStart!: string;

  @IsISO8601({ strict: true })
  readonly scheduledEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  readonly note?: string;
}

/** `GET /orders`. */
export class OrderListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly pageSize?: number;
}
