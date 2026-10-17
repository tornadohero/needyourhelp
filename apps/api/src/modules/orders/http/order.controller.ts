import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { OrderListResponse, OrderResponse } from '@mentor/api-contracts';

import { IDEMPOTENCY_HEADER } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { OrderService } from '../application/order.service';
import type { OrderCommand } from '../application/order.service';
import { toOrderListResponse, toOrderResponse } from './order.mapper';
import { translate } from './order-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateOrderDto, OrderListQueryDto } from './dto/order.dto';

/**
 * Order endpoints (`specs/05-api-spec.md` §Orders).
 *
 * The controller authenticates, validates, invokes the use case and maps the
 * response (`AGENTS.md` §6). There is no PATCH and no status field anywhere:
 * the state only ever moves through the four command routes below.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  /** `POST /orders`: the price comes from the service, never from the client. */
  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateOrderDto,
    @Headers(IDEMPOTENCY_HEADER.toLowerCase()) idempotencyKey?: string,
  ): Promise<OrderResponse> {
    return translate(async () => {
      const order = await this.orders.create(
        principal.userId,
        {
          serviceId: body.serviceId,
          childId: body.childId ?? null,
          scheduledStart: new Date(body.scheduledStart),
          scheduledEnd: new Date(body.scheduledEnd),
          note: body.note ?? null,
        },
        idempotencyKey,
      );
      return toOrderResponse(order);
    });
  }

  /** `GET /orders`: orders the account buys or delivers. */
  @Get()
  async list(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: OrderListQueryDto,
  ): Promise<OrderListResponse> {
    return translate(async () => {
      const result = await this.orders.listMine(principal.userId, {
        page: query.page,
        pageSize: query.pageSize,
      });
      return toOrderListResponse(result);
    });
  }

  /** `GET /orders/:id`. */
  @Get(':id')
  async detail(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderResponse> {
    return translate(async () =>
      toOrderResponse(await this.orders.getForParticipant(principal.userId, id)),
    );
  }

  /** `POST /orders/:id/cancel`: the buyer, while the order is unpaid. */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderResponse> {
    return translate(async () => toOrderResponse(await this.run(principal.userId, id, 'cancel')));
  }

  /** `POST /orders/:id/confirm`: the provider accepts a paid order. */
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderResponse> {
    return translate(async () => toOrderResponse(await this.run(principal.userId, id, 'confirm')));
  }

  /** `POST /orders/:id/start`: the session begins. */
  @Post(':id/start')
  @HttpCode(200)
  async start(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderResponse> {
    return translate(async () => toOrderResponse(await this.run(principal.userId, id, 'start')));
  }

  /** `POST /orders/:id/complete`: delivered, and reviewable from here (T017). */
  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OrderResponse> {
    return translate(async () => toOrderResponse(await this.run(principal.userId, id, 'complete')));
  }

  private run(userId: string, orderId: string, command: OrderCommand) {
    return this.orders.runCommand(userId, orderId, command);
  }
}
