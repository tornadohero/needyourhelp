import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryIdempotencyStore } from '../../common/idempotency/in-memory-idempotency.store';
import { IDEMPOTENCY_STORE } from '../../common/idempotency/idempotency.store';
import { isMockAdapterAllowed } from '../../common/runtime/environment';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentService } from './application/payment.service';
import { PAYMENT_GATEWAY } from './domain/payment-gateway';
import { PAYMENT_NOTIFICATION_VERIFIER } from './domain/payment-notification-verifier';
import { PAYMENT_REPOSITORY } from './domain/payment.repository';
import { PaymentController } from './http/payment.controller';
import { PassthroughNotificationVerifier } from './infrastructure/passthrough-notification.verifier';
import { MockPaymentGateway } from './infrastructure/mock-payment.gateway';
import { PrismaPaymentRepository } from './infrastructure/prisma-payment.repository';
import { CachingWeChatCertificateProvider } from './infrastructure/wechat/wechat-certificate.provider';
import { resolveWeChatPayConfig } from './infrastructure/wechat/wechat-pay-config';
import { WeChatPaymentGateway } from './infrastructure/wechat/wechat-payment.gateway';
import { WeChatNotificationVerifier } from './infrastructure/wechat/wechat-notification.verifier';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Payment context (`specs/03-architecture-spec.md` §Backend modules: payments).
 *
 * Adapter selection mirrors the auth context (T003):
 * - `PAYMENT_PROVIDER=wechat` uses the official v3 adapter, and fails fast when
 *   a secret is missing;
 * - `PAYMENT_PROVIDER=mock` (the default outside production) uses the mock,
 *   which production refuses.
 *
 * A gateway and its notification format always come as a pair: the mock takes
 * the platform's own payload, WeChat takes a signed and encrypted one.
 */
@Module({
  imports: [AnalyticsModule, AuthModule, OrdersModule],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const environment = config.get<string>('NODE_ENV');
        const provider = (config.get<string>('PAYMENT_PROVIDER') ?? '').toLowerCase();

        if (provider === 'wechat') {
          const wechatConfig = resolveWeChatPayConfig(config, environment);
          if (!wechatConfig) {
            throw new Error(
              'PAYMENT_PROVIDER=wechat requires WECHAT_PAY_* configuration; see .env.example.',
            );
          }
          const certificates = new CachingWeChatCertificateProvider({ config: wechatConfig });
          return new WeChatPaymentGateway({ config: wechatConfig, certificates });
        }

        if (!isMockAdapterAllowed(environment)) {
          throw new Error('The mock payment adapter is not allowed in production.');
        }
        return new MockPaymentGateway({ environment });
      },
    },
    {
      provide: PAYMENT_NOTIFICATION_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const environment = config.get<string>('NODE_ENV');
        const provider = (config.get<string>('PAYMENT_PROVIDER') ?? '').toLowerCase();

        if (provider === 'wechat') {
          const wechatConfig = resolveWeChatPayConfig(config, environment);
          if (!wechatConfig) {
            throw new Error(
              'PAYMENT_PROVIDER=wechat requires WECHAT_PAY_* configuration; see .env.example.',
            );
          }
          return new WeChatNotificationVerifier({
            config: wechatConfig,
            certificates: new CachingWeChatCertificateProvider({ config: wechatConfig }),
          });
        }

        return new PassthroughNotificationVerifier({ environment });
      },
    },
    // Single-instance idempotency today; the Redis-backed store is T022.
    { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
  ],
  // The gateway and the payment repository are exported so the refund context
  // (T016) can reuse the same adapter and read the captured payment.
  exports: [PaymentService, PAYMENT_GATEWAY, PAYMENT_REPOSITORY],
})
export class PaymentsModule {}
