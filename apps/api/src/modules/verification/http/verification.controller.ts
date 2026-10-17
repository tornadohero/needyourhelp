import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  MyVerificationResponse,
  VerificationCaseResponse,
  VerificationUploadUrlResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { VerificationService } from '../application/verification.service';
import { toMyVerificationResponse, toVerificationCaseResponse } from './verification.mapper';
import { translate } from './verification-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateVerificationCaseDto,
  MyVerificationQueryDto,
  RequestUploadUrlDto,
} from './dto/verification.dto';

/**
 * Provider-side verification endpoints (`specs/05-api-spec.md` §Verification).
 *
 * The controller authenticates, validates, invokes the use case and maps the
 * response (`AGENTS.md` §6). The outcome of a case is decided by an admin
 * command, never here.
 */
@Controller('verification')
export class VerificationController {
  constructor(@Inject(VerificationService) private readonly verification: VerificationService) {}

  @Post('cases')
  @UseGuards(JwtAuthGuard)
  async createCase(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateVerificationCaseDto,
  ): Promise<VerificationCaseResponse> {
    return translate(async () => {
      const created = await this.verification.createCase(principal.userId, {
        verificationType: body.verificationType,
      });
      return toVerificationCaseResponse(created, []);
    });
  }

  /** `GET /verification/me`: a user reads only their own verification state. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyVerification(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: MyVerificationQueryDto,
  ): Promise<MyVerificationResponse> {
    return translate(async () => {
      const { providerId, views } = await this.verification.listMyCases(
        principal.userId,
        query.providerType ?? 'TUTORING',
      );
      return toMyVerificationResponse(providerId, views);
    });
  }

  @Post('cases/:id/documents/upload-url')
  @UseGuards(JwtAuthGuard)
  async requestUploadUrl(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: RequestUploadUrlDto,
  ): Promise<VerificationUploadUrlResponse> {
    return translate(async () => {
      const { document, upload } = await this.verification.requestUploadUrl(principal.userId, id, {
        documentType: body.documentType,
        contentType: body.contentType,
        byteSize: body.byteSize,
        filename: body.filename ?? null,
        fileHash: body.fileHash,
      });

      return {
        documentId: document.id,
        documentType: document.documentType,
        uploadUrl: upload.url,
        method: upload.method,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      };
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post('cases/:id/submit')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async submitCase(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: MyVerificationQueryDto,
  ): Promise<VerificationCaseResponse> {
    return translate(async () => {
      const { case: submitted, documents } = await this.verification.submitCase(
        principal.userId,
        id,
        query.providerType ?? 'TUTORING',
      );
      return toVerificationCaseResponse(submitted, documents);
    });
  }
}
