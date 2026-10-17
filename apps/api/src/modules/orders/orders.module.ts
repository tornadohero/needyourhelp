import { Module } from '@nestjs/common';

import { InMemoryIdempotencyStore } from '../../common/idempotency/in-memory-idempotency.store';
import { IDEMPOTENCY_STORE } from '../../common/idempotency/idempotency.store';
import { AuthModule } from '../auth/auth.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { ProviderModule } from '../provider/provider.module';
import { ServicesModule } from '../services/services.module';
import { OrderService } from './application/order.service';
import { ORDER_REPOSITORY } from './domain/order.repository';
import { OrderController } from './http/order.controller';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Order context (`specs/02-domain-model.md` §Order aggregate).
 *
 * The order is the source of truth for its own status and the only place where
 * the money of a booking is computed. It borrows every gate instead of
 * duplicating it: published service (T009), discoverable provider (T010),
 * teacher compliance (T007) and availability (T011). Payment (T014) will move it
 * to `PAID`; nothing here sets that state.
 */
@Module({
  imports: [
    AnalyticsModule,
    AuthModule,
    IdentityModule,
    ProfileModule,
    ProviderModule,
    ServicesModule,
    ComplianceModule,
    AvailabilityModule,
    DiscoveryModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    // Single-instance idempotency today; the Redis-backed store is T022.
    { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
  ],
  exports: [OrderService],
})
export class OrdersModule {}
