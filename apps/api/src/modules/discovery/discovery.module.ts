import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PlatformModule } from '../platform/platform.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ProviderDiscoveryService } from './application/provider-discovery.service';
import { PROVIDER_DIRECTORY } from './domain/provider-directory';
import { DiscoveryController } from './http/discovery.controller';
import { PrismaProviderDirectory } from './infrastructure/prisma-provider.directory';

/**
 * Discovery context: the public provider directory (T010).
 *
 * It reads, never writes: the provider (T005), verification (T006), compliance
 * (T007) and service (T009) contexts decide who is discoverable, and this module
 * only ever reads the result through {@link PROVIDER_DIRECTORY}.
 */
@Module({
  imports: [AnalyticsModule, AuthModule, PlatformModule],
  controllers: [DiscoveryController],
  providers: [
    ProviderDiscoveryService,
    { provide: PROVIDER_DIRECTORY, useClass: PrismaProviderDirectory },
  ],
  // The directory is exported so other read contexts (availability, T011) can
  // ask "is this provider discoverable?" without re-implementing the gate.
  exports: [ProviderDiscoveryService, PROVIDER_DIRECTORY],
})
export class DiscoveryModule {}
