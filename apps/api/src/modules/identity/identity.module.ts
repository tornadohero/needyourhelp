import { Module } from '@nestjs/common';

import { CONSENT_REPOSITORY } from './domain/consent.repository';
import { USER_REPOSITORY } from './domain/user.repository';
import { PrismaConsentRepository } from './infrastructure/prisma-consent.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

/**
 * Identity context (`specs/02-domain-model.md`): users, roles, sessions and
 * consents.
 *
 * The module has no controllers on purpose: `AuthModule` depends on it, so
 * declaring controllers here would create a cycle with the auth guards.
 */
@Module({
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: CONSENT_REPOSITORY, useClass: PrismaConsentRepository },
  ],
  exports: [USER_REPOSITORY, CONSENT_REPOSITORY],
})
export class IdentityModule {}
