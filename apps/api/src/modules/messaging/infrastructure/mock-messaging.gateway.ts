import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

  /**
   * Where the transport keeps its bytes.
   *
   * A real IM vendor stores messages on its side; this mock stores them in a
   * local JSON file so a development session survives a restart. The path is
   * `IM_MOCK_STORE` or `.mock-im-mailbox.json` next to the process — the
   * platform's database is never touched by the transport.
   */
  private readonly storePath = resolve(
    process.cwd(),
    process.env.IM_MOCK_STORE ?? '.mock-im-mailbox.json',
  );

  private loaded = false;

  constructor(private readonly options: { environment?: string; baseUrl?: string } = {}) {}

  /** Lazily read the transport's own store; a missing or broken file is empty. */
  private loadStore(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    if (!existsSync(this.storePath)) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.storePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [conversationId, messages] of Object.entries(
          parsed as Record<string, GatewayMessage[]>,
        )) {
          if (Array.isArray(messages)) {
            this.mailbox.set(conversationId, messages);
          }
        }
      }
    } catch {
      // A broken store is an empty store: the transport starts over, the
      // platform's references stay untouched.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(Object.fromEntries(this.mailbox), null, 2));
  }

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
    this.loadStore();
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
    this.persist();
    return { externalMessageId };
  }

  async listMessages(input: {
    providerConversationId: string;
    limit: number;
  }): Promise<GatewayMessage[]> {
    this.assertAllowed();
    this.loadStore();
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
