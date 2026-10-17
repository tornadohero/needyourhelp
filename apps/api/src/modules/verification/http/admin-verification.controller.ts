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
  AdminVerificationCaseResponse,
  AdminVerificationQueueResponse,
  VerificationDocumentAccessResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { VerificationAdminService } from '../application/verification-admin.service';
import {
  toAdminVerificationCaseResponse,
  toAdminVerificationQueueResponse,
} from './verification.mapper';
import { translate } from './verification-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  DocumentAccessDto,
  VerificationDecisionDto,
  VerificationQueueQueryDto,
} from './dto/verification.dto';

/**
 * Admin verification endpoints (`specs/05-api-spec.md` §Admin,
 * `specs/12-admin-spec.md` §Provider review workflow).
 *
 * A provider can never decide their own case: every route requires the admin
 * role, and each decision is an explicit command that is audited server-side.
 *
 * `POST /admin/verifications/:id/documents/:documentId/access-url` is not in
 * `specs/05-api-spec.md`; it is the minimal audited path required by
 * `specs/12-admin-spec.md` ("Identity-document access is logged") and
 * `specs/07-permission-spec.md` (document access is permissioned and audited).
 */
@Controller('admin/verifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminVerificationController {
  constructor(@Inject(VerificationAdminService) private readonly admin: VerificationAdminService) {}

  @Get()
  async listQueue(
    @Query() query: VerificationQueueQueryDto,
  ): Promise<AdminVerificationQueueResponse> {
    return translate(async () => {
      const items = await this.admin.listQueue({
        status: query.status,
        limit: query.limit ?? 50,
      });
      return toAdminVerificationQueueResponse(items);
    });
  }

  /** A decision command, not a resource creation: 200. */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: VerificationDecisionDto,
    @Req() request: Request,
  ): Promise<AdminVerificationCaseResponse> {
    return translate(async () => {
      const approved = await this.admin.approve(id, {
        actorUserId: principal.userId,
        reasonCode: body.reasonCode,
        notes: body.notes ?? null,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toAdminVerificationCaseResponse(approved);
    });
  }

  /** A decision command, not a resource creation: 200. */
  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: VerificationDecisionDto,
    @Req() request: Request,
  ): Promise<AdminVerificationCaseResponse> {
    return translate(async () => {
      const rejected = await this.admin.reject(id, {
        actorUserId: principal.userId,
        reasonCode: body.reasonCode,
        notes: body.notes ?? null,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });
      return toAdminVerificationCaseResponse(rejected);
    });
  }

  /** Short-lived, audited access to a private document. */
  @Post(':id/documents/:documentId/access-url')
  @HttpCode(200)
  async createDocumentAccessUrl(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() body: DocumentAccessDto,
    @Req() request: Request,
  ): Promise<VerificationDocumentAccessResponse> {
    return translate(async () => {
      const { download } = await this.admin.createDocumentAccessUrl(id, documentId, {
        actorUserId: principal.userId,
        reasonCode: body.reasonCode,
        notes: body.notes ?? null,
        requestId: getRequestId(request),
        ipHash: hashRequestIp(request),
      });

      return {
        documentId,
        downloadUrl: download.url,
        expiresAt: download.expiresAt.toISOString(),
      };
    });
  }
}
