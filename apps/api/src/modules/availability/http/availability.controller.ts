import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AvailabilityDeletionResponse,
  AvailabilityListResponse,
  AvailabilitySlotResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/http/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { AvailabilityService } from '../application/availability.service';
import {
  toAvailabilityDeletionResponse,
  toAvailabilityListResponse,
  toAvailabilitySlotResponse,
} from './availability.mapper';
import { translate } from './availability-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateAvailabilitySlotDto, ProviderAvailabilityQueryDto } from './dto/availability.dto';

/**
 * Availability endpoints (`specs/05-api-spec.md` §Availability).
 *
 * The self-service routes require a session; reading the bookable slots of a
 * provider is public, like the rest of discovery (T010). Route order is safe:
 * `me/availability` (POST/DELETE) and `:id/availability` (GET) never collide.
 */
@Controller('providers')
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

  /** `POST /providers/me/availability`. */
  @Post('me/availability')
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderAvailabilityQueryDto,
    @Body() body: CreateAvailabilitySlotDto,
  ): Promise<AvailabilitySlotResponse> {
    return translate(async () => {
      const slot = await this.availability.createSlot(
        principal.userId,
        query.providerType ?? 'TUTORING',
        {
          startAt: new Date(body.startAt),
          endAt: new Date(body.endAt),
          recurrenceRule: body.recurrenceRule ?? null,
        },
      );
      return toAvailabilitySlotResponse(slot);
    });
  }

  /** `DELETE /providers/me/availability/:id`: only an own, still-open slot. */
  @Delete('me/availability/:id')
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: ProviderAvailabilityQueryDto,
  ): Promise<AvailabilityDeletionResponse> {
    return translate(async () => {
      const slotId = await this.availability.deleteSlot(
        principal.userId,
        query.providerType ?? 'TUTORING',
        id,
      );
      return toAvailabilityDeletionResponse(slotId);
    });
  }

  /** `GET /providers/:id/availability`: future open slots, bounded. */
  @Get(':id/availability')
  @UseGuards(OptionalJwtAuthGuard)
  async list(@Param('id') id: string): Promise<AvailabilityListResponse> {
    return translate(async () =>
      toAvailabilityListResponse(await this.availability.listBookable(id)),
    );
  }
}
