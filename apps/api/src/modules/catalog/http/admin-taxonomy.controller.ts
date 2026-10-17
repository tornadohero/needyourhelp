import type { Request } from 'express';
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
import type {
  AdminTaxonomyListResponse,
  TaxonomyTermResponse,
  TaxonomyTypeName,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/http/guards/roles.guard';
import { Roles } from '../../auth/http/decorators/roles.decorator';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { hashRequestIp } from '../../../common/http/request-ip';
import { TAXONOMY_MAX_PAGE_SIZE, TAXONOMY_PAGE_DEFAULTS } from '../domain/taxonomy.model';
import { TaxonomyAdminService } from '../application/taxonomy-admin.service';
import { toAdminTaxonomyListResponse, toTaxonomyTermResponse } from './taxonomy.mapper';
import { translate } from './taxonomy-error-translator';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateTaxonomyTermDto,
  TaxonomyListQueryDto,
  UpdateTaxonomyTermDto,
} from './dto/taxonomy.dto';

/**
 * Admin taxonomy endpoints (`specs/05-api-spec.md` §Taxonomy,
 * `specs/12-admin-spec.md` §Admin principles).
 *
 * The taxonomy is platform configuration: every route requires an admin role and
 * every mutation is audited with a before/after snapshot. Terms are archived
 * (`active=false`) instead of deleted, because `service_terms` references them
 * and historical orders depend on the taxonomy snapshot.
 */
@Controller('admin/taxonomy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPS')
export class AdminTaxonomyController {
  constructor(@Inject(TaxonomyAdminService) private readonly taxonomy: TaxonomyAdminService) {}

  @Get()
  async list(@Query() query: TaxonomyListQueryDto): Promise<AdminTaxonomyListResponse> {
    return translate(async () => {
      const page = await this.taxonomy.list({
        type: query.type as TaxonomyTypeName | undefined,
        parentId: query.parentId,
        active: query.active,
        page: query.page ?? TAXONOMY_PAGE_DEFAULTS.page,
        pageSize: Math.min(
          query.pageSize ?? TAXONOMY_PAGE_DEFAULTS.pageSize,
          TAXONOMY_MAX_PAGE_SIZE,
        ),
      });
      return toAdminTaxonomyListResponse(page);
    });
  }

  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateTaxonomyTermDto,
    @Req() request: Request,
  ): Promise<TaxonomyTermResponse> {
    return translate(async () => {
      const term = await this.taxonomy.create(
        {
          type: body.type,
          code: body.code,
          name: body.name,
          parentId: body.parentId ?? null,
        },
        this.context(principal, request),
      );
      return toTaxonomyTermResponse(term);
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateTaxonomyTermDto,
    @Req() request: Request,
  ): Promise<TaxonomyTermResponse> {
    return translate(async () => {
      const term = await this.taxonomy.update(
        id,
        {
          name: body.name,
          parentId: body.parentId,
          active: body.active,
        },
        this.context(principal, request),
      );
      return toTaxonomyTermResponse(term);
    });
  }

  /** A state command, not a resource creation: 200. */
  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<TaxonomyTermResponse> {
    return translate(async () => {
      const term = await this.taxonomy.archive(id, this.context(principal, request));
      return toTaxonomyTermResponse(term);
    });
  }

  private context(
    principal: AuthPrincipal,
    request: Request,
  ): { actorUserId: string; requestId: string; ipHash: string | null } {
    return {
      actorUserId: principal.userId,
      requestId: getRequestId(request),
      ipHash: hashRequestIp(request),
    };
  }
}
