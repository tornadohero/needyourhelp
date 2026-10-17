import type { CustomDecorator } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

import type { ApiRole } from '@mentor/api-contracts';

export const ROLES_METADATA_KEY = 'auth:required-roles';

/**
 * Declare the roles allowed on a route.
 *
 * Roles are read from persisted `user_roles` by the guard; the decorator only
 * declares policy. A client can never grant itself a role.
 */
export const Roles = (...roles: ApiRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_METADATA_KEY, roles);
