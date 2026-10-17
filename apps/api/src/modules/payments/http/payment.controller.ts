import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  RawBody,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  PaymentNotificationResponse,
  PaymentSessionResponse,
  PaymentStatusResponse,
} from '@mentor/api-contracts';

import { IDEMPOTENCY_HEADER } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { PaymentService } from '../application/payment.service';
import {
  toPaymentNotificationResponse,
  toPaymentSessionResponse,
  toPaymentStatusResponse,
} from './payment.mapper';
import { translate } from './payment-error-translator';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

/**
 * Payment endpoints (`specs/05-api-spec.md` §Payments).
 *
 * `POST /payments/wechat/notify` is deliberately **not** behind
 * `JwtAuthGuard`: it is a server-to-server callback from the payment provider.
 * Everything it does is validated inside the service, and it never trusts the
 * amount it receives. Signature verification belongs to the WeChat adapter
 * (T015); the mock gateway used in V1 has no signature.
 */
@Controller()
export class PaymentController {
  constructor(@Inject(PaymentService) private readonly payments: PaymentService) {}

  /** `POST /orders/:id/payment-session`: provider parameters for the client. */
  @RateLimit('payments.session')
  @Post('orders/:id/payment-session')
  @UseGuards(JwtAuthGuard)
  async createSession(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey?: string,
  ): Promise<PaymentSessionResponse> {
    return translate(async () => {
      const result = await this.payments.createSession(principal.userId, {
        orderId: id,
        idempotencyKey,
      });
      return toPaymentSessionResponse(result);
    });
  }

  /** `GET /orders/:id/payment-status`: the order's state plus the provider's. */
  @Get('orders/:id/payment-status')
  @UseGuards(JwtAuthGuard)
  async status(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<PaymentStatusResponse> {
    return translate(async () =>
      toPaymentStatusResponse(await this.payments.getStatus(principal.userId, id)),
    );
  }

  /**
   * `POST /payments/wechat/notify`: server-to-server, unauthenticated.
   *
   * The signature covers the exact bytes WeChat sent, so the verifier sees the
   * raw body — never a re-serialized object.
   */
  @Post('payments/wechat/notify')
  @HttpCode(200)
  async notify(
    @Req() request: Request,
    @RawBody() rawBody?: Buffer,
  ): Promise<PaymentNotificationResponse> {
    return translate(async () =>
      toPaymentNotificationResponse(
        await this.payments.handleCallback({
          headers: request.headers,
          body: rawBody ? rawBody.toString('utf8') : JSON.stringify(request.body ?? null),
        }),
      ),
    );
  }
}
