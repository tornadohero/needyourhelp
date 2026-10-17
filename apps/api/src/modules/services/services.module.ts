import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ProviderModule } from '../provider/provider.module';
import { ProviderServiceService } from './application/provider-service.service';
import { SERVICE_REPOSITORY } from './domain/service.repository';
import { ProviderServiceController } from './http/provider-service.controller';
import { PrismaServiceRepository } from './infrastructure/prisma-service.repository';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Service context (`specs/02-domain-model.md` §Service aggregate: "Owns
 * sellable service configuration and price").
 *
 * Dependencies, in one direction only:
 * - the taxonomy (T008) resolves the tags of a service;
 * - the provider context (T005) owns the application and the publication gate.
 *
 * The provider context never reads `services`: it consumes the
 * `SERVICE_READINESS` port, whose real adapter
 * (`infrastructure/prisma-service.readiness.ts`) is bound in
 * `ProviderModule` — exactly how the verification gate was wired in T006.
 */
@Module({
  imports: [AnalyticsModule, AuthModule, ProviderModule, CatalogModule],
  controllers: [ProviderServiceController],
  providers: [
    ProviderServiceService,
    { provide: SERVICE_REPOSITORY, useClass: PrismaServiceRepository },
  ],
  exports: [ProviderServiceService, SERVICE_REPOSITORY],
})
export class ServicesModule {}
