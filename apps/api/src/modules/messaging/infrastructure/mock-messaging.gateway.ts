import { randomUUID } from 'node:crypto';

import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import type {
  BlockUserInput,
  ConversationRef,
  CreateGatewayConversationInput,
  GatewayMessage,
  MessagingGateway,
  SendMessageInput,
  SendSystemMessageInput,
  SentMessage,
} from '../domain/messaging-gateway';

/**
 * Deterministic in-memory IM adapter for local, development and test
 * environments (`specs/03-architecture-spec.md` §External provider ports).
 *
 * It implements the transport contract only: no vendor SDK, no message content
 * stored anywhere. Production refuses it, so a mock can never become a
 * production code path (`AGENTS.md` §15).
 */
export class MockMessagingGateway implements MessagingGateway {
  /** Observable in tests: what the platform handed to the transport. */
  readonly conversations: CreateGatewayConversationInput[] = [];
  readonly systemMessages: SendSystemMessageInput[] = [];
  readonly blockedPairs: BlockUserInput[] = [];
  /**
   * The mock transport's mailbox, per transport conversation (T028 gap G4).
   *
   * This is the *transport's* store, not the platform's: the platform still
   * persists only `message_refs`.
   */
  readonly mailbox = new Map<string, GatewayMessage[]>();

  constructor(private readonly options: { environment?: string; baseUrl?: string } = {}) {}

  async createConversation(input: CreateGatewayConversationInput): Promise<ConversationRef> {
    this.assertAllowed();
    this.conversations.push(input);
    return { providerConversationId: `mock-conv-${randomUUID()}` };
  }

  async sendSystemMessage(input: SendSystemMessageInput): Promise<void> {
    this.assertAllowed();
    // Template code + params only: no rendered personal data is ever sent.
    this.systemMessages.push(input);
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    this.assertAllowed();
    const externalMessageId = `mock-msg-${randomUUID()}`;
    const messages = this.mailbox.get(input.providerConversationId) ?? [];
    messages.push({
      externalMessageId,
      senderUserId: input.senderUserId,
      messageType: input.messageType,
      body: input.body,
      createdAt: new Date().toISOString(),
    });
    this.mailbox.set(input.providerConversationId, messages);
    return { externalMessageId };
  }

  async listMessages(input: {
    providerConversationId: string;
    limit: number;
  }): Promise<GatewayMessage[]> {
    this.assertAllowed();
    return (this.mailbox.get(input.providerConversationId) ?? []).slice(-input.limit);
  }

  async blockUser(input: BlockUserInput): Promise<void> {
    this.assertAllowed();
    this.blockedPairs.push(input);
  }

  private assertAllowed(): void {
    if (!isMockAdapterAllowed(this.options.environment)) {
      throw new Error(
        'MockMessagingGateway is not allowed in production; configure a real IM adapter.',
      );
    }
  }
}
