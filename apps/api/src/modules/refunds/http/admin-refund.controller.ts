import type { Request } from 'express';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RefundResponse } from '@mentor/api-contracts';

import { IDEMPOTENCY_HEADER } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { RefundService } from '../application/refund.service';
import { toRefundResponse } from './refund.mapper';
import { translate } from './refund-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AdminRefundDto } from './dto/refund.dto';

/**
 * Admin refund command (`specs/05-api-spec.md` §Admin,
 * `specs/12-admin-spec.md`: "initiate refund when authorized").
 *
 * This is the only route that moves money back to a customer, so it requires the
 * admin role and every call is audited with actor, reason, before/after snapshot
 * and request id.
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminRefundController {
  constructor(@Inject(RefundService) private readonly refunds: RefundService) {}

  @Post(':id/refund')
  @HttpCode(200)
  async refund(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: AdminRefundDto,
    @Req() request: Request,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey?: string,
  ): Promise<RefundResponse> {
    return translate(async () =>
      toRefundResponse(
        await this.refunds.executeRefund(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          {
            amountMinor: body.amountMinor,
            reason: body.reason ?? null,
            idempotencyKey,
          },
        ),
      ),
    );
  }
}
