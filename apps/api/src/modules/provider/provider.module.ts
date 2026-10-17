import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PlatformModule } from '../platform/platform.module';
import { PrismaServiceReadiness } from '../services/infrastructure/prisma-service.readiness';
import { PrismaVerificationReadiness } from '../verification/infrastructure/prisma-verification-readiness';
import { ComposedProviderReadinessGates } from './application/composed-provider-readiness.gates';
import { ProviderAdminService } from './application/provider-admin.service';
import { ProviderApplicationService } from './application/provider-application.service';
import { PROVIDER_CAPABILITY_REPOSITORY } from './domain/provider-capability.repository';
import { PROVIDER_PROFILE_REPOSITORY } from './domain/provider-profile.repository';
import {
  PROVIDER_READINESS_GATES,
  SERVICE_READINESS,
  VERIFICATION_READINESS,
} from './domain/provider-readiness.gates';
import { AdminProviderController } from './http/admin-provider.controller';
import { ProviderController } from './http/provider.controller';
import { PrismaProviderCapabilityRepository } from './infrastructure/prisma-provider-capability.repository';
import { PrismaProviderProfileRepository } from './infrastructure/prisma-provider-profile.repository';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Provider context: onboarding application, capabilities and the admin approval
 * decision (`specs/02-domain-model.md` §Provider aggregate).
 *
 * Verification is a separate aggregate (T006): it is reached through the
 * {@link VERIFICATION_READINESS} port, so this module never reads verification
 * tables. Discovery and services are T010/T009.
 */
@Module({
  imports: [AnalyticsModule, AuthModule, IdentityModule, AuditModule, PlatformModule],
  controllers: [ProviderController, AdminProviderController],
  providers: [
    ProviderApplicationService,
    ProviderAdminService,
    { provide: PROVIDER_PROFILE_REPOSITORY, useClass: PrismaProviderProfileRepository },
    { provide: PROVIDER_CAPABILITY_REPOSITORY, useClass: PrismaProviderCapabilityRepository },
    // Verification decides its gate from T006 onwards, services from T009.
    { provide: VERIFICATION_READINESS, useClass: PrismaVerificationReadiness },
    { provide: SERVICE_READINESS, useClass: PrismaServiceReadiness },
    { provide: PROVIDER_READINESS_GATES, useClass: ComposedProviderReadinessGates },
  ],
  exports: [
    ProviderApplicationService,
    ProviderAdminService,
    PROVIDER_PROFILE_REPOSITORY,
    PROVIDER_CAPABILITY_REPOSITORY,
  ],
})
export class ProviderModule {}
