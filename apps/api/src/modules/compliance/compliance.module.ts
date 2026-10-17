import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProviderModule } from '../provider/provider.module';
import { TeacherComplianceService } from './application/teacher-compliance.service';
import { AdminComplianceController } from './http/admin-compliance.controller';

/**
 * Teacher compliance context (`specs/06-verification-state-machine.md`
 * §Teacher compliance).
 *
 * Compliance is a per-capability state: it is separate from provider approval
 * (T005) and from identity/education verification (T006), and it is the only
 * gate that decides whether a teacher capability may be ordered
 * (`specs/01-business-rules.md` §Teacher provider).
 *
 * The capability aggregate belongs to the provider context, so this module
 * reaches it through ports instead of owning the table. The orderability gate
 * is exported for T013 (orders).
 */
@Module({
  imports: [AuthModule, AuditModule, ProviderModule],
  controllers: [AdminComplianceController],
  providers: [TeacherComplianceService],
  exports: [TeacherComplianceService],
})
export class ComplianceModule {}
