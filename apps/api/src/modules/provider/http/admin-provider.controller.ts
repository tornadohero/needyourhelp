import type { Request } from 'express';
import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { ProviderProfileResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { ProviderAdminService } from '../application/provider-admin.service';
import { toProviderProfileResponse } from './provider.mapper';
import { translate } from './provider-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ApproveProviderDto, RejectProviderDto, SuspendProviderDto } from './dto/provider.dto';

/**
 * Admin provider decisions (`specs/12-admin-spec.md` §Provider review workflow;
 * `specs/07-permission-spec.md`: only ADMIN/OPS review providers).
 *
 * A provider can never approve itself: the route requires the admin role, and
 * the decision is an explicit command that is audited server-side.
 */
@Controller('admin/providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminProviderController {
  constructor(@Inject(ProviderAdminService) private readonly admin: ProviderAdminService) {}

  /** A decision command, not a resource creation: 200. */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: ApproveProviderDto,
    @Req() request: Request,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.admin.approve(id, {
        actorUserId: principal.userId,
        reason: body.reason ?? null,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  /** A decision command, not a resource creation: 200. */
  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: RejectProviderDto,
    @Req() request: Request,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.admin.reject(id, {
        actorUserId: principal.userId,
        reason: body.reason,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  /** `POST /admin/providers/:id/suspend` (200): takes the provider out of discovery. */
  @Post(':id/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: SuspendProviderDto,
    @Req() request: Request,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.admin.suspend(id, {
        actorUserId: principal.userId,
        reason: body.reason,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  /** `POST /admin/providers/:id/restore` (200): back to approved. */
  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: ApproveProviderDto,
    @Req() request: Request,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.admin.restore(id, {
        actorUserId: principal.userId,
        reason: body.reason ?? null,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }
}
