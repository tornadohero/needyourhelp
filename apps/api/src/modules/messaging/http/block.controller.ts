import { Controller, Delete, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { BlockResponse, UnblockResponse } from '@mentor/api-contracts';

import { JwtAuthGuard } from '../../auth/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/http/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../auth/domain/auth-session.model';
import { BlockService } from '../application/block.service';
import { toBlockResponse, toUnblockResponse } from './messaging.mapper';
import { translate } from './messaging-error-translator';

/**
 * Block endpoints (`specs/05-api-spec.md` §Messaging).
 *
 * Blocking is the safety valve of the messaging domain: it stops new
 * conversations in both directions, freezes the pair's existing ones and tells
 * the transport to stop delivering.
 *
 * There is deliberately no block-list route: `specs/05-api-spec.md` defines none
 * and inventing one is not needed to enforce the rule.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class BlockController {
  constructor(@Inject(BlockService) private readonly blocks: BlockService) {}

  /** `POST /users/:id/block`. */
  @Post(':id/block')
  async block(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<BlockResponse> {
    return translate(async () => toBlockResponse(await this.blocks.block(principal.userId, id)));
  }

  /** `DELETE /users/:id/block`. */
  @Delete(':id/block')
  async unblock(
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<UnblockResponse> {
    return translate(async () => {
      const result = await this.blocks.unblock(principal.userId, id);
      return toUnblockResponse(result.blockedUserId);
    });
  }
}
