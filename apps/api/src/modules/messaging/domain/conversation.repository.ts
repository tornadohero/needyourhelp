import type {
  Conversation,
  ConversationPage,
  ConversationStatus,
  CreateConversationInput,
  MessageReference,
  MessageType,
} from './conversation.model';

/** Dependency-injection token for {@link ConversationRepository}. */
export const CONVERSATION_REPOSITORY = 'CONVERSATION_REPOSITORY';

export interface ConversationRepository {
  /** Conversation + members in one transaction. */
  create(input: CreateConversationInput): Promise<Conversation>;

  findById(id: string): Promise<Conversation | null>;

  /** Own conversations, newest first. */
  listByUser(
    userId: string,
    options: { page: number; pageSize: number },
  ): Promise<ConversationPage>;

  /** Only ever called with a status the domain decided. */
  setStatus(id: string, status: ConversationStatus): Promise<Conversation>;

  /** Conversations of exactly this pair, for block/unblock. */
  listBetweenUsers(firstUserId: string, secondUserId: string): Promise<Conversation[]>;

  /**
   * A reference to a message the transport accepted (T028 gap G4).
   *
   * No content is stored here — only what a moderation decision needs.
   */
  addMessageReference(input: {
    conversationId: string;
    externalMessageId: string;
    senderUserId: string;
    messageType: MessageType;
  }): Promise<MessageReference>;

  /** Newest last, bounded: a thread is never read whole. */
  listMessageReferences(
    conversationId: string,
    options: { limit: number },
  ): Promise<MessageReference[]>;
}
