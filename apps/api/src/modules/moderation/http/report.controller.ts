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
import type { CreateReportResponse, ReportListResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { ModerationService } from '../application/moderation.service';
import {
  toCreateReportResponse,
  toModerationCaseResponse,
  toReportListResponse,
} from './moderation.mapper';
import { translate } from './moderation-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AppealDto, CreateReportDto, ReportListQueryDto } from './dto/moderation.dto';
import type { ModerationCaseResponse } from '@mentor/api-contracts';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

/**
 * Report intake (`specs/05-api-spec.md` §Reports).
 *
 * Anybody may report; the response only ever says that it was taken, never what
 * the moderator thinks (`AGENTS.md` §9: internal moderation notes stay
 * internal).
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(@Inject(ModerationService) private readonly moderation: ModerationService) {}

  /** `POST /reports` (201). */
  @RateLimit('reports.create')
  @Post('reports')
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateReportDto,
  ): Promise<CreateReportResponse> {
    return translate(async () =>
      toCreateReportResponse(
        await this.moderation.createReport(principal.userId, {
          targetType: body.targetType,
          targetId: body.targetId,
          reasonCode: body.reasonCode,
          description: body.description ?? null,
        }),
      ),
    );
  }

  /** `GET /me/reports`: what the caller reported, newest first. */
  @Get('me/reports')
  async listMine(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ReportListQueryDto,
  ): Promise<ReportListResponse> {
    return translate(async () =>
      toReportListResponse(
        await this.moderation.listOwnReports(principal.userId, {
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  /** `POST /reports/:id/appeal` (200): the appeal path of `specs/06` §Moderation. */
  @Post('reports/:id/appeal')
  @HttpCode(200)
  async appeal(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: AppealDto,
    @Req() request: Request,
  ): Promise<ModerationCaseResponse> {
    return translate(async () =>
      toModerationCaseResponse(
        await this.moderation.appeal(principal.userId, id, {
          reason: body.reason,
          requestId: getRequestId(request),
        }),
      ),
    );
  }
}
