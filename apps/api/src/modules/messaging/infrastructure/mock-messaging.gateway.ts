import { randomUUID } from 'node:crypto';

import { isMockAdapterAllowed } from '../../../common/runtime/environment';
import type {
  BlockUserInput,
  ConversationRef,
  CreateGatewayConversationInput,
  MessagingGateway,
  SendSystemMessageInput,
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
