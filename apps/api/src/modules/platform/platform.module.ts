import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminService } from './application/platform-admin.service';
import { FEATURE_FLAG_REPOSITORY } from './domain/feature-flag.repository';
import { PLATFORM_RULE_REPOSITORY } from './domain/platform-rule.repository';
import { AdminPlatformController } from './http/admin-platform.controller';
import { PrismaFeatureFlagRepository } from './infrastructure/prisma-feature-flag.repository';
import { PrismaPlatformRuleRepository } from './infrastructure/prisma-platform-rule.repository';

/**
 * Platform configuration context: feature flags and versioned platform rules.
 *
 * Both change what the whole platform does, so both are reachable only through
 * admin routes and every change is audited (`specs/12-admin-spec.md` §Audit).
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminPlatformController],
  providers: [
    PlatformAdminService,
    { provide: FEATURE_FLAG_REPOSITORY, useClass: PrismaFeatureFlagRepository },
    { provide: PLATFORM_RULE_REPOSITORY, useClass: PrismaPlatformRuleRepository },
  ],
  exports: [FEATURE_FLAG_REPOSITORY, PLATFORM_RULE_REPOSITORY, PlatformAdminService],
})
export class PlatformModule {}
