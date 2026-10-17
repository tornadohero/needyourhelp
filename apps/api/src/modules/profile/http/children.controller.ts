import type { Request } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  ChildDeletionResponse,
  ChildListResponse,
  ChildProfileResponse,
} from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { getRequestId } from '../../../common/http/request-context';
import { ChildProfileService } from '../application/child-profile.service';
import { translate } from './profile-error-translator';
import { toChildResponse } from './profile.mapper';
// Value import on purpose: `ValidationPipe` needs the DTO class at runtime
// through the emitted `design:paramtypes` metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateChildDto, UpdateChildDto } from './dto/profile.dto';

/**
 * Child profile endpoints (`specs/05-api-spec.md` §Profile).
 *
 * Every route is guardian-scoped: the child id is resolved through the
 * authenticated account, and a non-guardian is rejected with
 * `CHILD_ACCESS_DENIED` (`specs/14-test-strategy.md` E2E-06).
 */
@Controller('me/children')
@UseGuards(JwtAuthGuard)
export class ChildrenController {
  constructor(@Inject(ChildProfileService) private readonly children: ChildProfileService) {}

  @Post()
  async create(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: CreateChildDto,
    @Req() request: Request,
  ): Promise<ChildProfileResponse> {
    return translate(async () => {
      const child = await this.children.create(
        principal.userId,
        {
          nickname: body.nickname,
          birthYear: body.birthYear ?? null,
          gradeCode: body.gradeCode ?? null,
          schoolName: body.schoolName ?? null,
          learningGoals: body.learningGoals ?? null,
          consentPolicyVersion: body.consentPolicyVersion,
        },
        // Evidence reference for the consent captured with the profile.
        `request:${getRequestId(request)}`,
      );
      return toChildResponse(child);
    });
  }

  @Get()
  async list(@CurrentUser() principal: AuthPrincipal): Promise<ChildListResponse> {
    return translate(async () => {
      const children = await this.children.list(principal.userId);
      return { children: children.map(toChildResponse) };
    });
  }

  @Get(':id')
  async get(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ChildProfileResponse> {
    return translate(async () => toChildResponse(await this.children.get(principal.userId, id)));
  }

  @Patch(':id')
  async update(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateChildDto,
  ): Promise<ChildProfileResponse> {
    return translate(async () =>
      toChildResponse(await this.children.update(principal.userId, id, body)),
    );
  }

  @Delete(':id')
  async remove(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ChildDeletionResponse> {
    return translate(async () => {
      const childId = await this.children.remove(principal.userId, id);
      return { id: childId, deleted: true } satisfies ChildDeletionResponse;
    });
  }
}
