import { Module } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY } from './domain/audit-log.repository';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';

/**
 * Audit context: append-only records of privileged mutations
 * (`AGENTS.md` §7, `specs/12-admin-spec.md` §Audit).
 */
@Module({
  providers: [{ provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository }],
  exports: [AUDIT_LOG_REPOSITORY],
})
export class AuditModule {}
