import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminOperationsService } from './application/admin-operations.service';
import { ADMIN_READ_MODEL } from './domain/admin-read-model';
import { AdminBootstrapController } from './http/admin-bootstrap.controller';
import { AdminController } from './http/admin.controller';
import { PrismaAdminReadModel } from './infrastructure/prisma-admin.read-model';

/**
 * Operations context (`specs/03-architecture-spec.md` §Backend modules: admin;
 * `specs/12-admin-spec.md`).
 *
 * It reads across contexts through one read model and never writes state that
 * another context owns: the provider decisions stay in the provider context, the
 * money decisions in payments and refunds, and moderation in moderation. The
 * only mutation here is a role change, which is audited.
 */
@Module({
  imports: [AuthModule, IdentityModule, AuditModule],
  controllers: [AdminController, AdminBootstrapController],
  providers: [
    AdminOperationsService,
    { provide: ADMIN_READ_MODEL, useClass: PrismaAdminReadModel },
  ],
  exports: [AdminOperationsService],
})
export class AdminModule {}
