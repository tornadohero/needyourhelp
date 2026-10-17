import { Inject, Injectable } from '@nestjs/common';

import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { USER_REPOSITORY } from '../../identity/domain/user.repository';
import type { UserRepository } from '../../identity/domain/user.repository';
import { assertPeer } from '../domain/conversation-policy';
import { BLOCK_REPOSITORY } from '../domain/block.repository';
import type { BlockRecord, BlockRepository } from '../domain/block.repository';
import { CONVERSATION_REPOSITORY } from '../domain/conversation.repository';
import type { ConversationRepository } from '../domain/conversation.repository';
import { messagingInvalidState } from '../domain/messaging.errors';
import { MESSAGING_GATEWAY } from '../domain/messaging-gateway';
import type { MessagingGateway } from '../domain/messaging-gateway';

/**
 * Blocking (`specs/05-api-spec.md` §Messaging, `specs/09-im-spec.md` §Safety:
 * "blocked user cannot start new conversation").
 *
 * A block is stored one-directionally — it is the blocker's own safety
 * decision — but it stops messaging in both directions and freezes the
 * conversations of the pair. The transport is told too, so delivery stops
 * outside our database as well.
 */
@Injectable()
export class BlockService {
  constructor(
    @Inject(BLOCK_REPOSITORY) private readonly blocks: BlockRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(MESSAGING_GATEWAY) private readonly gateway: MessagingGateway,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  /** `POST /users/:id/block`. */
  async block(blockerUserId: string, blockedUserId: string): Promise<BlockRecord> {
    assertPeer(blockerUserId, blockedUserId);
    await this.assertKnown(blockedUserId);

    // Vendor side first: a failed block leaves nothing behind to clean up.
    await this.gateway.blockUser({ blockerUserId, blockedUserId: blockedUserId });
    const record = await this.blocks.add(blockerUserId, blockedUserId);

    // Existing conversations of the pair are frozen, not deleted: the history
    // stays available to a moderator (`specs/09` §Safety, T018).
    await this.freezeConversations(blockerUserId, blockedUserId, 'BLOCKED');

    return record;
  }

  /** `DELETE /users/:id/block`. */
  async unblock(blockerUserId: string, blockedUserId: string): Promise<{ blockedUserId: string }> {
    assertPeer(blockerUserId, blockedUserId);

    await this.blocks.remove(blockerUserId, blockedUserId);

    // Only the pair's still-frozen conversations open again; a closed one stays
    // closed. The transport is re-enabled on the next conversation.
    await this.freezeConversations(blockerUserId, blockedUserId, 'OPEN');

    return { blockedUserId };
  }

  private async freezeConversations(
    blockerUserId: string,
    blockedUserId: string,
    status: 'BLOCKED' | 'OPEN',
  ): Promise<void> {
    const shared = await this.conversations.listBetweenUsers(blockerUserId, blockedUserId);

    for (const conversation of shared) {
      // Unblocking only re-opens what the block froze.
      if (status === 'BLOCKED' && conversation.status === 'OPEN') {
        await this.conversations.setStatus(conversation.id, 'BLOCKED');
      }
      if (status === 'OPEN' && conversation.status === 'BLOCKED') {
        await this.conversations.setStatus(conversation.id, 'OPEN');
      }
    }
  }

  private async assertKnown(userId: string): Promise<void> {
    if (!isUuid(userId)) {
      throw messagingInvalidState('Unknown account.');
    }
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) {
      throw messagingInvalidState('Unknown account.');
    }
  }
}
