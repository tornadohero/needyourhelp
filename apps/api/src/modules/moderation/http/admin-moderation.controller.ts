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
import type { Request } from 'express';
import type {
  AdminReportQueueResponse,
  ModerationCaseResponse,
  ModerationDecisionResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { ModerationService } from '../application/moderation.service';
import {
  toAdminReportQueueResponse,
  toModerationCaseResponse,
  toModerationDecisionResponse,
} from './moderation.mapper';
import { translate } from './moderation-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  FinalizeCaseDto,
  ReportListQueryDto,
  ResolveReportDto,
  TransitionCaseDto,
} from './dto/moderation.dto';

/**
 * Moderation commands (`specs/05-api-spec.md` §Admin,
 * `specs/12-admin-spec.md` §Moderation).
 *
 * Every route here requires the admin/ops role and every mutation is audited
 * with actor, reason, before/after snapshot and request id.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminModerationController {
  constructor(@Inject(ModerationService) private readonly moderation: ModerationService) {}

  /** `GET /admin/reports`: the queue, newest first. */
  @Get('admin/reports')
  async queue(@Query() query: ReportListQueryDto): Promise<AdminReportQueueResponse> {
    return translate(async () =>
      toAdminReportQueueResponse(
        await this.moderation.listQueue({
          status: query.status ?? null,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  /** `POST /admin/reports/:id/resolve` (200): the audited decision. */
  @Post('admin/reports/:id/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: ResolveReportDto,
    @Req() request: Request,
  ): Promise<ModerationDecisionResponse> {
    return translate(async () =>
      toModerationDecisionResponse(
        await this.moderation.resolveReport(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          {
            resolution: body.resolution,
            outcome: body.outcome,
            action: body.action,
            severity: body.severity,
          },
        ),
      ),
    );
  }

  /** `POST /admin/moderation/:id/transition` (200): investigate or ask for action. */
  @Post('admin/moderation/:id/transition')
  @HttpCode(200)
  async transition(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: TransitionCaseDto,
    @Req() request: Request,
  ): Promise<ModerationCaseResponse> {
    return translate(async () =>
      toModerationCaseResponse(
        await this.moderation.transitionCase(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          { status: body.status, note: body.note ?? null },
        ),
      ),
    );
  }

  /** `POST /admin/moderation/:id/finalize` (200): closes an appeal for good. */
  @Post('admin/moderation/:id/finalize')
  @HttpCode(200)
  async finalize(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: FinalizeCaseDto,
    @Req() request: Request,
  ): Promise<ModerationCaseResponse> {
    return translate(async () =>
      toModerationCaseResponse(
        await this.moderation.finalizeAppeal(
          {
            actorUserId: principal.userId,
            requestId: getRequestId(request),
            ipHash: hashRequestIp(request),
          },
          id,
          { decision: body.decision, decisionReason: body.decisionReason },
        ),
      ),
    );
  }
}
