import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TaxonomyAdminService } from './application/taxonomy-admin.service';
import { TAXONOMY_REPOSITORY } from './domain/taxonomy.repository';
import { AdminTaxonomyController } from './http/admin-taxonomy.controller';
import { PrismaTaxonomyRepository } from './infrastructure/prisma-taxonomy.repository';

/**
 * Catalog context (`specs/02-domain-model.md` §Catalog,
 * `specs/05-api-spec.md` §Taxonomy).
 *
 * The taxonomy is the shared vocabulary of the platform: services tag it (T009),
 * discovery filters on it (T010) and teacher compliance restrictions reference
 * its codes (T007). It is therefore managed as platform configuration — admin
 * only, archived instead of deleted, every mutation audited.
 *
 * The repository stays exported: T009/T010 read terms through the same port
 * instead of touching Prisma.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminTaxonomyController],
  providers: [
    TaxonomyAdminService,
    { provide: TAXONOMY_REPOSITORY, useClass: PrismaTaxonomyRepository },
  ],
  exports: [TAXONOMY_REPOSITORY, TaxonomyAdminService],
})
export class CatalogModule {}
