import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminComplianceItemResponse,
  AdminComplianceQueueResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { TeacherComplianceService } from '../application/teacher-compliance.service';
import { toAdminComplianceItemResponse, toAdminComplianceQueueResponse } from './compliance.mapper';
import { translate } from './compliance-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ComplianceDecisionDto,
  ComplianceQueueQueryDto,
  RestrictComplianceDto,
} from './dto/compliance.dto';

/**
 * Admin teacher-compliance endpoints.
 *
 * `specs/05-api-spec.md` §Admin defines no compliance route, but
 * `specs/12-admin-spec.md` §Provider review workflow requires the reviewer to
 * see "teacher compliance" and `specs/06` requires every decision to be audited.
 * These are the minimal audited commands that satisfy T007; they should be
 * ratified into the API spec.
 *
 * A provider can never decide their own compliance: every route requires the
 * admin role, and the outcome is a per-capability state that only the
 * orderability gate reads.
 */
@Controller('admin/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminComplianceController {
  constructor(
    @Inject(TeacherComplianceService) private readonly compliance: TeacherComplianceService,
  ) {}

  @Get()
  async listQueue(@Query() query: ComplianceQueueQueryDto): Promise<AdminComplianceQueueResponse> {
    return translate(async () => {
      const items = await this.compliance.listQueue({
        status: query.status,
        limit: query.limit ?? 50,
      });
      return toAdminComplianceQueueResponse(items);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':capabilityId/start-review')
  @HttpCode(200)
  async startReview(
    @CurrentUser() principal: AuthPrincipal,
    @Param('capabilityId') capabilityId: string,
    @Body() body: ComplianceDecisionDto,
    @Req() request: Request,
  ): Promise<AdminComplianceItemResponse> {
    return translate(async () => {
      const item = await this.compliance.startReview(
        capabilityId,
        this.context(principal, request, body),
      );
      return toAdminComplianceItemResponse(item);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':capabilityId/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() principal: AuthPrincipal,
    @Param('capabilityId') capabilityId: string,
    @Body() body: ComplianceDecisionDto,
    @Req() request: Request,
  ): Promise<AdminComplianceItemResponse> {
    return translate(async () => {
      const item = await this.compliance.approve(
        capabilityId,
        this.context(principal, request, body),
      );
      return toAdminComplianceItemResponse(item);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':capabilityId/restrict')
  @HttpCode(200)
  async restrict(
    @CurrentUser() principal: AuthPrincipal,
    @Param('capabilityId') capabilityId: string,
    @Body() body: RestrictComplianceDto,
    @Req() request: Request,
  ): Promise<AdminComplianceItemResponse> {
    return translate(async () => {
      const item = await this.compliance.restrict(capabilityId, {
        ...this.context(principal, request, body),
        restriction: {
          allowedSubjectCodes: body.restriction.allowedSubjectCodes,
          allowedCityCodes: body.restriction.allowedCityCodes,
          allowedUntil: body.restriction.allowedUntil ?? null,
        },
      });
      return toAdminComplianceItemResponse(item);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':capabilityId/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() principal: AuthPrincipal,
    @Param('capabilityId') capabilityId: string,
    @Body() body: ComplianceDecisionDto,
    @Req() request: Request,
  ): Promise<AdminComplianceItemResponse> {
    return translate(async () => {
      const item = await this.compliance.reject(
        capabilityId,
        this.context(principal, request, body),
      );
      return toAdminComplianceItemResponse(item);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':capabilityId/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentUser() principal: AuthPrincipal,
    @Param('capabilityId') capabilityId: string,
    @Body() body: ComplianceDecisionDto,
    @Req() request: Request,
  ): Promise<AdminComplianceItemResponse> {
    return translate(async () => {
      const item = await this.compliance.suspend(
        capabilityId,
        this.context(principal, request, body),
      );
      return toAdminComplianceItemResponse(item);
    });
  }

  private context(
    principal: AuthPrincipal,
    request: Request,
    body: ComplianceDecisionDto,
  ): {
    actorUserId: string;
    reasonCode: string;
    notes: string | null;
    requestId: string;
    ipHash: string | null;
  } {
    return {
      actorUserId: principal.userId,
      reasonCode: body.reasonCode,
      notes: body.notes ?? null,
      requestId: getRequestId(request),
      ipHash: hashRequestIp(request),
    };
  }
}
