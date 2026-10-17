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
  UseGuards,
} from '@nestjs/common';
import type {
  ProviderServiceListResponse,
  ServiceResponse,
  DeliveryModeName,
  ProviderTypeName,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { ProviderServiceService } from '../application/provider-service.service';
import { toProviderServiceListResponse, toServiceResponse } from './service.mapper';
import { translate } from './service-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateServiceDto, ProviderServicesQueryDto, UpdateServiceDto } from './dto/service.dto';

/**
 * Provider service endpoints (`specs/05-api-spec.md` §Services).
 *
 * The controller authenticates, validates, invokes the use case and maps the
 * response (`AGENTS.md` §6): every price and duration rule lives in the domain,
 * and publication is only ever an explicit command.
 *
 * The public list of another provider's services
 * (`GET /providers/:id/services`) belongs to T010, which owns the
 * "only discoverable providers" rule.
 */
@Controller('providers/me/services')
@UseGuards(JwtAuthGuard)
export class ProviderServiceController {
  constructor(@Inject(ProviderServiceService) private readonly services: ProviderServiceService) {}

  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderServicesQueryDto,
    @Body() body: CreateServiceDto,
  ): Promise<ServiceResponse> {
    return translate(async () => {
      const service = await this.services.create(
        principal.userId,
        (query.providerType ?? 'TUTORING') as ProviderTypeName,
        {
          title: body.title,
          description: body.description ?? null,
          durationMinutes: body.durationMinutes,
          priceMinor: body.priceMinor,
          currency: body.currency,
          deliveryMode: body.deliveryMode as DeliveryModeName | undefined,
          subjectCodes: body.subjectCodes,
          gradeCodes: body.gradeCodes,
          skillCodes: body.skillCodes,
          cityCodes: body.cityCodes,
        },
      );
      return toServiceResponse(service);
    });
  }

  @Get()
  async list(
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ProviderServicesQueryDto,
  ): Promise<ProviderServiceListResponse> {
    return translate(async () => {
      const services = await this.services.listMine(
        principal.userId,
        (query.providerType ?? 'TUTORING') as ProviderTypeName,
      );
      return toProviderServiceListResponse(services);
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: ProviderServicesQueryDto,
    @Body() body: UpdateServiceDto,
  ): Promise<ServiceResponse> {
    return translate(async () => {
      const service = await this.services.update(
        principal.userId,
        (query.providerType ?? 'TUTORING') as ProviderTypeName,
        id,
        {
          title: body.title,
          description: body.description,
          durationMinutes: body.durationMinutes,
          priceMinor: body.priceMinor,
          currency: body.currency,
          deliveryMode: body.deliveryMode as DeliveryModeName | undefined,
          subjectCodes: body.subjectCodes,
          gradeCodes: body.gradeCodes,
          skillCodes: body.skillCodes,
          cityCodes: body.cityCodes,
        },
      );
      return toServiceResponse(service);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':id/publish')
  @HttpCode(200)
  async publish(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: ProviderServicesQueryDto,
  ): Promise<ServiceResponse> {
    return translate(async () => {
      const service = await this.services.publish(
        principal.userId,
        (query.providerType ?? 'TUTORING') as ProviderTypeName,
        id,
      );
      return toServiceResponse(service);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':id/unpublish')
  @HttpCode(200)
  async unpublish(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Query() query: ProviderServicesQueryDto,
  ): Promise<ServiceResponse> {
    return translate(async () => {
      const service = await this.services.unpublish(
        principal.userId,
        (query.providerType ?? 'TUTORING') as ProviderTypeName,
        id,
      );
      return toServiceResponse(service);
    });
  }
}
