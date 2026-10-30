import type { User } from '../../../src/modules/identity/domain/user.model';
import type { ProviderDirectory } from '../../../src/modules/discovery/domain/provider-directory';
import type {
  ProviderDetail,
  ProviderSearchPage,
} from '../../../src/modules/discovery/domain/provider-search.model';
import { FakeUserRepository } from '../profile/fakes';
import type {
  BlockRecord,
  BlockRepository,
} from '../../../src/modules/messaging/domain/block.repository';
import type {
  Conversation,
  ConversationPage,
  ConversationStatus,
  CreateConversationInput,
  MessageReference,
  MessageType,
} from '../../../src/modules/messaging/domain/conversation.model';
import type { ConversationRepository } from '../../../src/modules/messaging/domain/conversation.repository';
import type {
  BlockUserInput,
  ConversationRef,
  CreateGatewayConversationInput,
  MessagingGateway,
  GatewayMessage,
  SendMessageInput,
  SendSystemMessageInput,
  SentMessage,
} from '../../../src/modules/messaging/domain/messaging-gateway';

/** In-memory {@link ConversationRepository}. */
export class FakeConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messageReferences: MessageReference[] = [];

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: input.id,
      domain: input.domain,
      orderId: null,
      status: 'OPEN',
      providerConversationId: input.providerConversationId,
      members: input.members.map((member) => ({ ...member })),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listByUser(
    userId: string,
    options: { page: number; pageSize: number },
  ): Promise<ConversationPage> {
    const matching = [...this.conversations.values()]
      .filter((conversation) => conversation.members.some((member) => member.userId === userId))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

    return {
      items: matching.slice((options.page - 1) * options.pageSize, options.page * options.pageSize),
      total: matching.length,
    };
  }

  /** Names are presentation: the fake answers what a test seeded. */
  async memberDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    return new Map(userIds.map((id) => [id, `用户${id.slice(0, 4)}`]));
  }

  async addMessageReference(input: {
    conversationId: string;
    externalMessageId: string;
    senderUserId: string;
    messageType: MessageType;
  }): Promise<MessageReference> {
    const reference: MessageReference = {
      id: `msg-ref-${this.messageReferences.length + 1}`,
      conversationId: input.conversationId,
      externalMessageId: input.externalMessageId,
      senderUserId: input.senderUserId,
      messageType: input.messageType,
      moderationStatus: 'PENDING',
      createdAt: new Date(),
    };
    this.messageReferences.push(reference);
    return reference;
  }

  async listMessageReferences(
    conversationId: string,
    options: { limit: number },
  ): Promise<MessageReference[]> {
    return this.messageReferences
      .filter((reference) => reference.conversationId === conversationId)
      .slice(-options.limit);
  }

  async setStatus(id: string, status: ConversationStatus): Promise<Conversation> {
    const current = this.conversations.get(id);
    if (!current) {
      throw new Error(`unknown conversation ${id}`);
    }
    const updated: Conversation = { ...current, status, updatedAt: new Date() };
    this.conversations.set(id, updated);
    return updated;
  }

  async listBetweenUsers(firstUserId: string, secondUserId: string): Promise<Conversation[]> {
    return [...this.conversations.values()].filter(
      (conversation) =>
        conversation.members.some((member) => member.userId === firstUserId) &&
        conversation.members.some((member) => member.userId === secondUserId),
    );
  }
}

/** In-memory {@link BlockRepository}. */
export class FakeBlockRepository implements BlockRepository {
  readonly rows: BlockRecord[] = [];

  async add(blockerUserId: string, blockedUserId: string): Promise<BlockRecord> {
    const existing = this.rows.find(
      (row) => row.blockerUserId === blockerUserId && row.blockedUserId === blockedUserId,
    );
    if (existing) {
      return existing;
    }
    const record: BlockRecord = { blockerUserId, blockedUserId, createdAt: new Date() };
    this.rows.push(record);
    return record;
  }

  async remove(blockerUserId: string, blockedUserId: string): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.blockerUserId === blockerUserId && row.blockedUserId === blockedUserId,
    );
    if (index < 0) {
      return false;
    }
    this.rows.splice(index, 1);
    return true;
  }

  async existsBetween(firstUserId: string, secondUserId: string): Promise<boolean> {
    return this.rows.some(
      (row) =>
        (row.blockerUserId === firstUserId && row.blockedUserId === secondUserId) ||
        (row.blockerUserId === secondUserId && row.blockedUserId === firstUserId),
    );
  }
}

/**
 * {@link UserRepository} pinned to the ids a test uses.
 *
 * The messaging gates ask "is this account active?" by id, so a test needs to
 * decide the ids instead of accepting generated ones.
 */
export class DirectoryUserRepository extends FakeUserRepository {
  constructor(private readonly accounts: Record<string, User['status']>) {
    super();
  }

  override async findById(id: string): Promise<User | null> {
    const status = this.accounts[id];
    if (!status) {
      return null;
    }
    return {
      id,
      status,
      wechatOpenidHash: null,
      unionidHash: null,
      displayName: '用户',
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };
  }
}

/** The discovery gate (T010) as messaging sees it: on/off plus the owner. */
export class FakeProviderDirectory implements ProviderDirectory {
  constructor(
    private readonly discoverable: boolean,
    private readonly providerOwnerId: string,
    private readonly providerId: string,
  ) {}

  async search(): Promise<ProviderSearchPage> {
    return { hits: [], total: 0 };
  }

  async findDiscoverable(providerId: string): Promise<ProviderDetail | null> {
    if (!this.discoverable || providerId !== this.providerId) {
      return null;
    }
    return {
      provider: {
        id: providerId,
        userId: this.providerOwnerId,
        providerType: 'TUTORING',
        publicName: '李老师',
        headline: null,
        bio: null,
        avatarVisibility: 'PRIVATE',
        avatarAssetId: null,
        cityCode: 'BEIJING',
        serviceMode: 'ONLINE',
        approvalStatus: 'APPROVED',
        searchable: true,
        ratingAvg: null,
        ratingCount: 0,
        completedOrderCount: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      capabilities: [],
      services: [],
    };
  }
}

/**
 * {@link MessagingGateway} that records everything and never touches a network.
 */
export class FakeMessagingGateway implements MessagingGateway {
  readonly conversations: CreateGatewayConversationInput[] = [];
  readonly systemMessages: SendSystemMessageInput[] = [];
  readonly blockedPairs: BlockUserInput[] = [];
  /** What the platform handed to the transport (T028 gap G4). */
  readonly sentMessages: SendMessageInput[] = [];
  readonly mailbox = new Map<string, GatewayMessage[]>();

  async createConversation(input: CreateGatewayConversationInput): Promise<ConversationRef> {
    this.conversations.push(input);
    return { providerConversationId: `fake-conv-${input.conversationId}` };
  }

  async sendSystemMessage(input: SendSystemMessageInput): Promise<void> {
    this.systemMessages.push(input);
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    this.sentMessages.push(input);
    const externalMessageId = `fake-msg-${this.sentMessages.length}`;
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
    return (this.mailbox.get(input.providerConversationId) ?? []).slice(-input.limit);
  }

  async blockUser(input: BlockUserInput): Promise<void> {
    this.blockedPairs.push(input);
  }
}
