import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ProviderProfileResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { ProviderApplicationService } from '../application/provider-application.service';
import { toProviderProfileResponse } from './provider.mapper';
import { translate } from './provider-error-translator';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateProviderApplicationDto,
  ProviderQueryDto,
  UpdateProviderProfileDto,
} from './dto/provider.dto';

/**
 * Provider onboarding endpoints (`specs/05-api-spec.md` §Provider).
 *
 * The controller authenticates, validates, invokes the use case and maps the
 * response (`AGENTS.md` §6). Discovery routes (`GET /providers`,
 * `GET /providers/:id`) belong to T010 and are intentionally absent.
 */
@Controller('providers')
export class ProviderController {
  constructor(
    @Inject(ProviderApplicationService)
    private readonly applications: ProviderApplicationService,
  ) {}

  @RateLimit('applications.create')
  @Post('applications')
  @UseGuards(JwtAuthGuard)
  async createApplication(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateProviderApplicationDto,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.applications.createApplication(principal.userId, {
        providerType: body.providerType ?? 'TUTORING',
        publicName: body.publicName,
        headline: body.headline ?? null,
        bio: body.bio ?? null,
        avatarVisibility: body.avatarVisibility,
        cityCode: body.cityCode ?? null,
        serviceMode: body.serviceMode,
        capabilityTypes: body.capabilityTypes,
      });
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyApplication(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderQueryDto,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.applications.getMyApplication(
        principal.userId,
        query.providerType ?? 'TUTORING',
      );
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMyApplication(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderQueryDto,
    @Body() body: UpdateProviderProfileDto,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.applications.updateMyApplication(
        principal.userId,
        {
          ...(body.publicName === undefined ? {} : { publicName: body.publicName }),
          ...(body.headline === undefined ? {} : { headline: body.headline }),
          ...(body.bio === undefined ? {} : { bio: body.bio }),
          ...(body.avatarVisibility === undefined
            ? {}
            : { avatarVisibility: body.avatarVisibility }),
          ...(body.cityCode === undefined ? {} : { cityCode: body.cityCode }),
          ...(body.serviceMode === undefined ? {} : { serviceMode: body.serviceMode }),
          ...(body.capabilityTypes === undefined ? {} : { capabilityTypes: body.capabilityTypes }),
        },
        query.providerType ?? 'TUTORING',
      );
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post('me/submit')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async submitApplication(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderQueryDto,
  ): Promise<ProviderProfileResponse> {
    return translate(async () => {
      const application = await this.applications.submitApplication(
        principal.userId,
        query.providerType ?? 'TUTORING',
      );
      return toProviderProfileResponse(application.profile, application.capabilities);
    });
  }
}
