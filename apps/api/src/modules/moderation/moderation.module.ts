import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { OrdersModule } from '../orders/orders.module';
import { ProviderModule } from '../provider/provider.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ServicesModule } from '../services/services.module';
import { ModerationService } from './application/moderation.service';
import { MODERATION_REPOSITORY } from './domain/moderation.repository';
import { AdminModerationController } from './http/admin-moderation.controller';
import { ReportController } from './http/report.controller';
import { PrismaModerationRepository } from './infrastructure/prisma-moderation.repository';

/**
 * Moderation context (`specs/03-architecture-spec.md` §Backend modules:
 * moderation; `specs/12-admin-spec.md` §Moderation).
 *
 * It owns `reports` and `moderation_cases`: the intake of T012 lands here, and
 * every admin action leaves an audit row. Actions on other contexts are taken
 * through their own commands — hiding a review, disputing an order — never by
 * writing their state directly.
 */
@Module({
  imports: [
    AuthModule,
    IdentityModule,
    AuditModule,
    ProviderModule,
    ServicesModule,
    OrdersModule,
    ReviewsModule,
  ],
  controllers: [ReportController, AdminModerationController],
  providers: [
    ModerationService,
    { provide: MODERATION_REPOSITORY, useClass: PrismaModerationRepository },
  ],
  // Exported so the messaging context keeps intaking reports through the same
  // port instead of growing a second one.
  exports: [ModerationService, MODERATION_REPOSITORY],
})
export class ModerationModule {}
