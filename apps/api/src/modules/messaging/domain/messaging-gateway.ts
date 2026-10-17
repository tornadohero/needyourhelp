/**
 * The IM adapter port (`specs/03-architecture-spec.md` §External provider ports,
 * `specs/09-im-spec.md` §Adapter).
 *
 * The core domain never depends on a vendor SDK and never stores message
 * content: the gateway owns the transport, the platform owns only references.
 */

/** Dependency-injection token for {@link MessagingGateway}. */
export const MESSAGING_GATEWAY = 'MESSAGING_GATEWAY';

export type MessagingDomain = 'TUTORING' | 'CAREER';

/** What the platform keeps: the id the transport assigned. */
export interface ConversationRef {
  providerConversationId: string;
}

export interface CreateGatewayConversationInput {
  /** The platform-side id, so a provider can correlate callbacks. */
  conversationId: string;
  memberUserIds: string[];
  domain: MessagingDomain;
}

export interface SendSystemMessageInput {
  conversationId: string;
  providerConversationId: string;
  /** Template code + params: never rendered personal data (`specs/04` §notifications). */
  templateCode: string;
  params?: Record<string, unknown>;
}

export interface BlockUserInput {
  blockerUserId: string;
  blockedUserId: string;
}

/**
 * Messaging transport.
 *
 * `blockUser` is the vendor-side half of a block: our `blocks` table stays the
 * authority for the platform gate, but the transport has to stop delivering too
 * (`specs/09-im-spec.md` §Safety).
 */
export interface MessagingGateway {
  createConversation(input: CreateGatewayConversationInput): Promise<ConversationRef>;

  /** System messages are generated server-side (`specs/09` §System messages). */
  sendSystemMessage(input: SendSystemMessageInput): Promise<void>;

  blockUser(input: BlockUserInput): Promise<void>;
}
