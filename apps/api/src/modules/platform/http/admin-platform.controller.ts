import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminFeatureFlagListResponse,
  PlatformRuleListResponse,
  PlatformRuleResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { PlatformAdminService } from '../application/platform-admin.service';
import { translate } from './platform-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreatePlatformRuleDto, SetFeatureFlagDto } from './dto/platform.dto';

/**
 * Platform configuration routes (`specs/05-api-spec.md` §Admin).
 *
 * A flag or a published rule changes what the whole platform does, so both are
 * admin-only and both are audited (`specs/12` §Audit).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminPlatformController {
  constructor(@Inject(PlatformAdminService) private readonly platform: PlatformAdminService) {}

  /** `GET /admin/feature-flags`. */
  @Get('feature-flags')
  async listFlags(): Promise<AdminFeatureFlagListResponse> {
    return translate(async () => this.platform.listFlags());
  }

  /** `PATCH /admin/feature-flags/:key`. */
  @Patch('feature-flags/:key')
  async setFlag(
    @CurrentUser() principal: AuthPrincipal,
    @Param('key') key: string,
    @Body() body: SetFeatureFlagDto,
    @Req() request: Request,
  ): Promise<{ key: string; enabled: boolean }> {
    return translate(async () =>
      this.platform.setFlag(
        {
          actorUserId: principal.userId,
          requestId: getRequestId(request),
          ipHash: hashRequestIp(request),
        },
        key,
        body.enabled,
      ),
    );
  }

  /** `GET /admin/platform-rules`. */
  @Get('platform-rules')
  async listRules(@Query('ruleType') ruleType?: string): Promise<PlatformRuleListResponse> {
    return translate(async () => this.platform.listRules(ruleType ?? null));
  }

  /** `POST /admin/platform-rules` (201): a new draft version. */
  @Post('platform-rules')
  async createRule(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreatePlatformRuleDto,
    @Req() request: Request,
  ): Promise<PlatformRuleResponse> {
    return translate(async () =>
      this.platform.createRule(
        {
          actorUserId: principal.userId,
          requestId: getRequestId(request),
          ipHash: hashRequestIp(request),
        },
        {
          ruleType: body.ruleType,
          version: body.version,
          contentRef: body.contentRef,
          effectiveAt: body.effectiveAt ? new Date(body.effectiveAt) : null,
        },
      ),
    );
  }

  /** `POST /admin/platform-rules/:id/publish` (200): an audited publication. */
  @Post('platform-rules/:id/publish')
  @HttpCode(200)
  async publishRule(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<PlatformRuleResponse> {
    return translate(async () =>
      this.platform.publishRule(
        {
          actorUserId: principal.userId,
          requestId: getRequestId(request),
          ipHash: hashRequestIp(request),
        },
        id,
      ),
    );
  }
}
