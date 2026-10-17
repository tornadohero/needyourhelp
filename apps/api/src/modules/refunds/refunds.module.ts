import { Module } from '@nestjs/common';

import { InMemoryIdempotencyStore } from '../../common/idempotency/in-memory-idempotency.store';
import { IDEMPOTENCY_STORE } from '../../common/idempotency/idempotency.store';
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
    // Single-instance idempotency today; the Redis-backed store is T022.
    { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
  ],
  exports: [RefundService],
})
export class RefundsModule {}
