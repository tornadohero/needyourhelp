import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AccessLogMiddleware } from './common/monitoring/access-log.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestSizeLimitMiddleware } from './common/security/request-size-limit.middleware';
import { SecurityHeadersMiddleware } from './common/security/security-headers.middleware';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { SecurityModule } from './common/security/security.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AuthModule } from './modules/auth/auth.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ProviderModule } from './modules/provider/provider.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ServicesModule } from './modules/services/services.module';
import { VerificationModule } from './modules/verification/verification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      ignoreEnvFile: false,
    }),
    PrismaModule,
    IdentityModule,
    AuthModule,
    ProfileModule,
    ProviderModule,
    VerificationModule,
    ComplianceModule,
    CatalogModule,
    ServicesModule,
    // Discovery last: `GET /providers/me` and `/providers/me/services` must be
    // registered before `GET /providers/:id`, or `me` would parse as an id.
    DiscoveryModule,
    // Availability adds `me/availability` and `:id/availability`: no prefix
    // clash with the routes above.
    AvailabilityModule,
    MessagingModule,
    // Moderation before messaging: messaging intakes reports through the
    // moderation port, and `POST /reports` is registered here.
    ModerationModule,
    OrdersModule,
    PaymentsModule,
    RefundsModule,
    ReviewsModule,
    // Platform configuration (flags, rules) and the operations pages: admin
    // routes only, so their order does not clash with any client route.
    PlatformModule,
    AdminModule,
    SecurityModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // Access logs come after the request id, so every line carries one.
      .apply(
        RequestIdMiddleware,
        SecurityHeadersMiddleware,
        RequestSizeLimitMiddleware,
        AccessLogMiddleware,
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
