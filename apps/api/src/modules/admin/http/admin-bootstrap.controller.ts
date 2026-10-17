import { Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminRoleChangeResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { AdminOperationsService } from '../application/admin-operations.service';
import { toAdminRoleChangeResponse } from './admin.mapper';
import { translate } from './admin-error-translator';

/**
 * `POST /admin/bootstrap` (200): the first administrator.
 *
 * Deliberately its own controller: it is authenticated but **not** role-guarded,
 * because before the first admin nobody could pass a role guard. It closes
 * itself (the service refuses once any account holds `ADMIN`) and only exists
 * outside production, so the first run of the platform needs no database edit.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminBootstrapController {
  constructor(
    @Inject(AdminOperationsService) private readonly operations: AdminOperationsService,
  ) {}

  @Post('bootstrap')
  @HttpCode(200)
  async bootstrap(
    @CurrentUser() principal: AuthPrincipal,
    @Req() request: Request,
  ): Promise<AdminRoleChangeResponse> {
    return translate(async () =>
      toAdminRoleChangeResponse(
        await this.operations.bootstrapAdmin({
          actorUserId: principal.userId,
          requestId: getRequestId(request),
          ipHash: hashRequestIp(request),
        }),
      ),
    );
  }
}
