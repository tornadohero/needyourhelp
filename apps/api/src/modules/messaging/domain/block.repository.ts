/** Dependency-injection token for {@link BlockRepository}. */
export const BLOCK_REPOSITORY = 'BLOCK_REPOSITORY';

export interface BlockRecord {
  blockerUserId: string;
  blockedUserId: string;
  createdAt: Date;
}

/**
 * `blocks` — the platform authority for "these two cannot talk"
 * (`specs/09-im-spec.md` §Safety: "blocked user cannot start new conversation").
 *
 * A block is one-directional in storage and blocking in effect for both
 * directions of messaging.
 */
export interface BlockRepository {
  /** Idempotent: blocking twice changes nothing. */
  add(blockerUserId: string, blockedUserId: string): Promise<BlockRecord>;

  remove(blockerUserId: string, blockedUserId: string): Promise<boolean>;

  /** Either direction: neither side may start a conversation. */
  existsBetween(firstUserId: string, secondUserId: string): Promise<boolean>;
}
