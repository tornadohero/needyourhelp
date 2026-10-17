import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { MAX_REFUND_REASON_LENGTH } from '../../domain/refund-policy';

/**
 * `POST /orders/:id/refund-request`.
 *
 * There is deliberately no `amountMinor` here: the server computes what is still
 * refundable, and the money only moves through the audited admin command.
 */
export class RefundRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFUND_REASON_LENGTH)
  readonly reason?: string;
}

/**
 * `POST /admin/orders/:id/refund`.
 *
 * `amountMinor` is optional: without it the server refunds everything still
 * refundable, and with it the value is still validated against that ceiling.
 */
export class AdminRefundDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  readonly amountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFUND_REASON_LENGTH)
  readonly reason?: string;
}
