import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { OrdersModule } from '../orders/orders.module';
import { PlatformModule } from '../platform/platform.module';
import { ProviderModule } from '../provider/provider.module';
import { ReviewService } from './application/review.service';
import { REVIEW_REPOSITORY } from './domain/review.repository';
import { ProviderReviewController } from './http/provider-review.controller';
import { ReviewController } from './http/review.controller';
import { PrismaReviewRepository } from './infrastructure/prisma-review.repository';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Review context (`specs/03-architecture-spec.md` §Backend modules: reviews).
 *
 * It writes `reviews` and the provider's rating, and reads orders and the
 * discovery directory: it never decides order state and never duplicates a gate.
 */
@Module({
  imports: [
    AnalyticsModule,
    AuthModule,
    OrdersModule,
    ProviderModule,
    DiscoveryModule,
    PlatformModule,
  ],
  controllers: [ReviewController, ProviderReviewController],
  providers: [ReviewService, { provide: REVIEW_REPOSITORY, useClass: PrismaReviewRepository }],
  // The repository is exported so moderation (T018) can hide a review through
  // the same port, instead of writing review state itself.
  exports: [ReviewService, REVIEW_REPOSITORY],
})
export class ReviewsModule {}
