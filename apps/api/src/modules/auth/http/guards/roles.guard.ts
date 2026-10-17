import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiRole } from '@mentor/api-contracts';

import { readPrincipal } from '../decorators/current-user.decorator';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';

/**
 * RBAC guard (`specs/07-permission-spec.md`).
 *
 * Must run after `JwtAuthGuard`. Roles come from the persisted `user_roles`
 * attached to the principal; nothing in the request can influence them.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiRole[] | undefined>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const principal = readPrincipal(context.switchToHttp().getRequest());
    if (!principal) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not permitted.' });
    }

    const granted = new Set(principal.roles);
    if (!required.some((role) => granted.has(role))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Not permitted.' });
    }

    return true;
  }
}
