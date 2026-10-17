import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { ChildProfileService } from './application/child-profile.service';
import { ConsentService } from './application/consent.service';
import { ProfileService } from './application/profile.service';
import { CHILD_PROFILE_REPOSITORY } from './domain/child-profile.repository';
import { PARENT_PROFILE_REPOSITORY } from './domain/parent-profile.repository';
import { ChildrenController } from './http/children.controller';
import { ConsentsController } from './http/consents.controller';
import { ProfileController } from './http/profile.controller';
import { PrismaChildProfileRepository } from './infrastructure/prisma-child-profile.repository';
import { PrismaParentProfileRepository } from './infrastructure/prisma-parent-profile.repository';

/**
 * Profile context: the account's own profile, its child profiles and its
 * consents (`specs/02-domain-model.md`, `specs/05-api-spec.md` §Profile).
 *
 * `AuthModule` supplies the guards and `IdentityModule` the user/consent
 * repositories. There is no cycle: auth depends on identity, never on profile.
 */
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [ProfileController, ChildrenController, ConsentsController],
  providers: [
    ProfileService,
    ChildProfileService,
    ConsentService,
    { provide: PARENT_PROFILE_REPOSITORY, useClass: PrismaParentProfileRepository },
    { provide: CHILD_PROFILE_REPOSITORY, useClass: PrismaChildProfileRepository },
  ],
  // The child repository is exported so another context (orders, T013) can check
  // guardian ownership through the port instead of reading the table.
  exports: [ProfileService, ChildProfileService, ConsentService, CHILD_PROFILE_REPOSITORY],
})
export class ProfileModule {}
