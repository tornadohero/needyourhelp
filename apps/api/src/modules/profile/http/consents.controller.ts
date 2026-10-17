import type { Request } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CONSENT_TYPES,
  type ConsentListResponse,
  type ConsentResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { ConsentService } from '../application/consent.service';
import { consentRequired } from '../domain/profile.errors';
import { translate } from './profile-error-translator';
import { toConsentResponse } from './profile.mapper';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GrantConsentDto } from './dto/profile.dto';

/**
 * Consent endpoints.
 *
 * `specs/05-api-spec.md` lists no consent route; these three exist because
 * `specs/10-privacy-and-minors.md` requires explicit, versioned consent records
 * plus a withdrawal path, and T004 must deliver consent. They are the smallest
 * surface that satisfies it and are documented as an addition to the API spec.
 */
@Controller('me/consents')
@UseGuards(JwtAuthGuard)
export class ConsentsController {
  constructor(@Inject(ConsentService) private readonly consents: ConsentService) {}

  @Get()
  async list(@CurrentUser() principal: AuthPrincipal): Promise<ConsentListResponse> {
    return translate(async () => {
      const consents = await this.consents.list(principal.userId);
      return { consents: consents.map(toConsentResponse) };
    });
  }

  @Post()
  async grant(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: GrantConsentDto,
    @Req() request: Request,
  ): Promise<ConsentResponse> {
    return translate(async () => {
      // An explicit `granted: false` is not a grant: it is a rejection.
      if (body.granted === false) {
        throw consentRequired('Consent must be granted explicitly.');
      }

      const consent = await this.consents.grant(
        principal.userId,
        { consentType: body.consentType, policyVersion: body.policyVersion },
        `request:${getRequestId(request)}`,
      );
      return toConsentResponse(consent);
    });
  }

  @Delete(':consentType')
  async revoke(
    @CurrentUser() principal: AuthPrincipal,
    @Param('consentType', new ParseEnumPipe(CONSENT_TYPES))
    consentType: (typeof CONSENT_TYPES)[number],
  ): Promise<ConsentResponse> {
    return translate(async () =>
      toConsentResponse(await this.consents.revoke(principal.userId, consentType)),
    );
  }
}
