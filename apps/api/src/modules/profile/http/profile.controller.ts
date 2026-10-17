import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import type { ProfileResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { ProfileService } from '../application/profile.service';
import { translate } from './profile-error-translator';
import { toProfileResponse } from './profile.mapper';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UpdateProfileDto } from './dto/profile.dto';

/**
 * `GET|PUT /me/profile` (`specs/05-api-spec.md` §Profile).
 *
 * The controller only authenticates, validates, invokes the use case and maps
 * the response (`AGENTS.md` §6).
 */
@Controller('me')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profileService: ProfileService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() principal: AuthPrincipal): Promise<ProfileResponse> {
    return translate(async () =>
      toProfileResponse(await this.profileService.getProfile(principal.userId)),
    );
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return translate(async () =>
      toProfileResponse(
        await this.profileService.updateProfile(principal.userId, {
          ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
          ...(body.avatarUrl === undefined ? {} : { avatarUrl: body.avatarUrl }),
          ...(body.cityCode === undefined ? {} : { cityCode: body.cityCode }),
          ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
        }),
      ),
    );
  }
}
