import { Module } from '@nestjs/common';

import {
  IDEMPOTENCY_STORE,
  type IdempotencyStore,
} from '../../common/idempotency/idempotency.store';
import { idempotencyStoreFor } from '../../common/idempotency/idempotency-store.factory';
import { REDIS } from '../../infrastructure/redis/redis.module';
import type { RedisHandle } from '../../infrastructure/redis/redis.client';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { RefundService } from './application/refund.service';
import { REFUND_REPOSITORY } from './domain/refund.repository';
import { AdminRefundController } from './http/admin-refund.controller';
import { RefundController } from './http/refund.controller';
import { PrismaRefundRepository } from './infrastructure/prisma-refund.repository';

/**
 * Refund context (`specs/03-architecture-spec.md` §Backend modules: refunds).
 *
 * The amount is decided here and nowhere else; the gateway only executes it and
 * the order context owns the state. Every executed refund is audited.
 */
@Module({
  imports: [AuthModule, OrdersModule, PaymentsModule, AuditModule],
  controllers: [RefundController, AdminRefundController],
  providers: [
    RefundService,
    { provide: REFUND_REPOSITORY, useClass: PrismaRefundRepository },
    {
      provide: IDEMPOTENCY_STORE,
      inject: [{ token: REDIS, optional: true }],
      useFactory: (redis: RedisHandle | undefined): IdempotencyStore =>
        idempotencyStoreFor(redis, 'refunds'),
    },
  ],
  exports: [RefundService],
})
export class RefundsModule {}
