import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminAuditLogListResponse,
  AdminDashboardCounts,
  AdminOrderListResponse,
  AdminProviderListResponse,
  AdminRoleChangeResponse,
  AdminUserListResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { AdminOperationsService } from '../application/admin-operations.service';
import {
  toAdminAuditLogListResponse,
  toAdminDashboardResponse,
  toAdminOrderListResponse,
  toAdminProviderListResponse,
  toAdminRoleChangeResponse,
  toAdminUserListResponse,
} from './admin.mapper';
import { translate } from './admin-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AdminAuditLogQueryDto,
  AdminOrderListQueryDto,
  AdminProviderListQueryDto,
  AdminUserListQueryDto,
  GrantRoleDto,
} from './dto/admin.dto';

/**
 * Operations pages (`specs/05-api-spec.md` §Admin, `specs/11-pages-and-ui.md`
 * §Admin pages, `specs/12-admin-spec.md`).
 *
 * Every route requires the admin/ops role: these listings see across accounts,
 * so least privilege is the gate (`specs/12` §Admin principles), and the one
 * mutation here — a role change — is audited.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminController {
  constructor(
    @Inject(AdminOperationsService) private readonly operations: AdminOperationsService,
  ) {}

  /** `GET /admin/dashboard`. */
  @Get('dashboard')
  async dashboard(): Promise<AdminDashboardCounts> {
    return translate(async () => toAdminDashboardResponse(await this.operations.dashboard()));
  }

  /** `GET /admin/users`. */
  @Get('users')
  async listUsers(@Query() query: AdminUserListQueryDto): Promise<AdminUserListResponse> {
    return translate(async () =>
      toAdminUserListResponse(
        await this.operations.listUsers({
          status: query.status ?? null,
          search: query.search ?? null,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  /** `POST /admin/users/:id/roles`: the audited way to grant a role. */
  @Post('users/:id/roles')
  async grantRole(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: GrantRoleDto,
    @Req() request: Request,
  ): Promise<AdminRoleChangeResponse> {
    return translate(async () =>
      toAdminRoleChangeResponse(
        await this.operations.grantRole(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          body.role,
        ),
      ),
    );
  }

  /** `DELETE /admin/users/:id/roles/:role`: the audited counterpart. */
  @Delete('users/:id/roles/:role')
  async revokeRole(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Param('role') role: string,
    @Req() request: Request,
  ): Promise<AdminRoleChangeResponse> {
    return translate(async () =>
      toAdminRoleChangeResponse(
        await this.operations.revokeRole(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          role,
        ),
      ),
    );
  }

  /** `GET /admin/providers`: the review queue. */
  @Get('providers')
  async listProviders(
    @Query() query: AdminProviderListQueryDto,
  ): Promise<AdminProviderListResponse> {
    return translate(async () =>
      toAdminProviderListResponse(
        await this.operations.listProviders({
          approvalStatus: query.approvalStatus ?? null,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  /** `GET /admin/orders`. */
  @Get('orders')
  async listOrders(@Query() query: AdminOrderListQueryDto): Promise<AdminOrderListResponse> {
    return translate(async () =>
      toAdminOrderListResponse(
        await this.operations.listOrders({
          status: query.status ?? null,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  /** `GET /admin/audit-logs`. */
  @Get('audit-logs')
  async listAuditLogs(@Query() query: AdminAuditLogQueryDto): Promise<AdminAuditLogListResponse> {
    return translate(async () =>
      toAdminAuditLogListResponse(
        await this.operations.listAuditLogs({
          actorUserId: query.actorUserId ?? null,
          action: query.action ?? null,
          resourceType: query.resourceType ?? null,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }
}
