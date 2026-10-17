import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IdentityModule } from '../identity/identity.module';
import { ModerationModule } from '../moderation/moderation.module';
import { BlockService } from './application/block.service';
import { ConversationService } from './application/conversation.service';
import { BLOCK_REPOSITORY } from './domain/block.repository';
import { CONVERSATION_REPOSITORY } from './domain/conversation.repository';
import { MESSAGING_GATEWAY } from './domain/messaging-gateway';
import { BlockController } from './http/block.controller';
import { ConversationController } from './http/conversation.controller';
import { PrismaBlockRepository } from './infrastructure/prisma-block.repository';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository';
import { MockMessagingGateway } from './infrastructure/mock-messaging.gateway';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Messaging context (`specs/03-architecture-spec.md` §Backend modules:
 * messaging; `specs/09-im-spec.md`).
 *
 * The transport is an adapter: the domain depends only on
 * {@link MESSAGING_GATEWAY}, so a real IM provider replaces the mock without
 * touching a single use case. Discoverability is borrowed from T010 and the
 * moderation workflow stays in T018 — this module only ever *intakes* a report.
 */
@Module({
  // Reporting is borrowed from the moderation context (T018): this module only
  // intakes a report, the workflow belongs to moderation.
  imports: [AnalyticsModule, AuthModule, IdentityModule, DiscoveryModule, ModerationModule],
  controllers: [ConversationController, BlockController],
  providers: [
    ConversationService,
    BlockService,
    { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
    { provide: BLOCK_REPOSITORY, useClass: PrismaBlockRepository },
    {
      provide: MESSAGING_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MockMessagingGateway({
          environment: config.get<string>('NODE_ENV'),
          baseUrl: config.get<string>('IM_BASE_URL'),
        }),
    },
  ],
  exports: [ConversationService, BlockService],
})
export class MessagingModule {}
