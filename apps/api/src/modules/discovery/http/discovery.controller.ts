import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type {
  ProviderDetailResponse,
  ProviderSearchResponse,
  PublicProviderServiceListResponse,
} from '@mentor/api-contracts';

import { OptionalJwtAuthGuard } from '../../auth/http/guards/optional-jwt-auth.guard';
import { ProviderDiscoveryService } from '../application/provider-discovery.service';
import {
  toProviderDetailResponse,
  toProviderSearchResponse,
  toPublicProviderServiceListResponse,
} from './discovery.mapper';
import { translate } from './discovery-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ProviderSearchQueryDto } from './dto/provider-search.dto';
import { RateLimit } from '../../../common/security/rate-limit.interceptor';

/**
 * Public discovery endpoints (`specs/05-api-spec.md` §Provider).
 *
 * Browsing is possible with or without a session (`OptionalJwtAuthGuard`):
 * `specs/07-permission-spec.md` lets any user read public provider profiles, and
 * `specs/13-security-spec.md` asks for rate limiting on public search, which is
 * T022.
 *
 * Route order matters and is covered by tests: `ProviderController`
 * (`GET /providers/me`) and the service routes (`GET /providers/me/services`)
 * are registered before this controller, so `me` is never parsed as a provider
 * id.
 */
@Controller('providers')
@UseGuards(OptionalJwtAuthGuard)
export class DiscoveryController {
  constructor(
    @Inject(ProviderDiscoveryService) private readonly discovery: ProviderDiscoveryService,
  ) {}

  /** `GET /providers`: discoverable providers only, always paged. */
  @RateLimit('search.public')
  @Get()
  async search(@Query() query: ProviderSearchQueryDto): Promise<ProviderSearchResponse> {
    return translate(async () =>
      toProviderSearchResponse(
        await this.discovery.search({
          domain: query.domain,
          providerType: query.providerType,
          city: query.city,
          subject: query.subject,
          grade: query.grade,
          deliveryMode: query.deliveryMode,
          minPrice: query.minPrice,
          maxPrice: query.maxPrice,
          verifiedOnly: query.verifiedOnly,
          page: query.page,
          pageSize: query.pageSize,
          sort: query.sort,
        }),
      ),
    );
  }

  /** `GET /providers/:id`: the public profile and its published services. */
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ProviderDetailResponse> {
    return translate(async () => toProviderDetailResponse(await this.discovery.getDetail(id)));
  }

  /** `GET /providers/:id/services`: published services only. */
  @Get(':id/services')
  async services(@Param('id') id: string): Promise<PublicProviderServiceListResponse> {
    return translate(async () =>
      toPublicProviderServiceListResponse((await this.discovery.listServices(id)).services),
    );
  }
}
