import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RefundListResponse, RefundRequestResponse } from '@mentor/api-contracts';

import { IDEMPOTENCY_HEADER } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { RefundService } from '../application/refund.service';
import { toRefundListResponse, toRefundRequestResponse } from './refund.mapper';
import { translate } from './refund-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RefundRequestDto } from './dto/refund.dto';

/**
 * Customer refund endpoints (`specs/05-api-spec.md` §Refund).
 *
 * A request here only puts the order in the refund branch: the money moves
 * through the audited admin command, never from a customer route
 * (`specs/12-admin-spec.md`).
 */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class RefundController {
  constructor(@Inject(RefundService) private readonly refunds: RefundService) {}

  /** `POST /orders/:id/refund-request`: the buyer asks for their money back. */
  @Post(':id/refund-request')
  @HttpCode(200)
  async request(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: RefundRequestDto,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey?: string,
  ): Promise<RefundRequestResponse> {
    return translate(async () =>
      toRefundRequestResponse(
        await this.refunds.requestRefund(principal.userId, id, {
          reason: body.reason ?? null,
          idempotencyKey,
        }),
      ),
    );
  }

  /** `GET /orders/:id/refunds`: what has been refunded for this order. */
  @Get(':id/refunds')
  async list(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<RefundListResponse> {
    return translate(async () =>
      toRefundListResponse(await this.refunds.listRefunds(principal.userId, id)),
    );
  }
}
