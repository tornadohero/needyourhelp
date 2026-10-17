import type { ProviderDirectory } from '../../../src/modules/discovery/domain/provider-directory';
import type {
  ProviderDetail,
  ProviderSearchPage,
} from '../../../src/modules/discovery/domain/provider-search.model';
import { slotOverlapError } from '../../../src/modules/availability/domain/availability.errors';
import {
  CONFLICTING_STATUSES,
  findOverlap,
} from '../../../src/modules/availability/domain/availability-policy';
import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CreateSlotInput,
} from '../../../src/modules/availability/domain/availability-slot.model';
import type { AvailabilitySlotRepository } from '../../../src/modules/availability/domain/availability-slot.repository';

/**
 * In-memory {@link AvailabilitySlotRepository}.
 *
 * It enforces the same two rules as the Prisma adapter — no overlapping slots
 * and a claim that can only win once — so the service can be tested without a
 * database.
 */
export class FakeAvailabilitySlotRepository implements AvailabilitySlotRepository {
  readonly slots = new Map<string, AvailabilitySlot>();
  private sequence = 0;

  async create(input: CreateSlotInput): Promise<AvailabilitySlot> {
    const clash = findOverlap(
      [...this.slots.values()].filter(
        (slot) =>
          slot.providerId === input.providerId && CONFLICTING_STATUSES.includes(slot.status),
      ),
      { startAt: input.startAt, endAt: input.endAt },
    );
    if (clash) {
      throw slotOverlapError();
    }

    this.sequence += 1;
    const slot: AvailabilitySlot = {
      id: `00000000-0000-4000-9000-${String(this.sequence).padStart(12, '0')}`,
      providerId: input.providerId,
      startAt: input.startAt,
      endAt: input.endAt,
      recurrenceRule: input.recurrenceRule,
      status: 'OPEN',
    };
    this.slots.set(slot.id, slot);
    return slot;
  }

  async findById(id: string): Promise<AvailabilitySlot | null> {
    return this.slots.get(id) ?? null;
  }

  async listByProvider(
    providerId: string,
    options: { statuses?: readonly AvailabilityStatus[]; from?: Date; limit?: number } = {},
  ): Promise<AvailabilitySlot[]> {
    const matching = [...this.slots.values()]
      .filter(
        (slot) =>
          slot.providerId === providerId &&
          (options.statuses === undefined || options.statuses.includes(slot.status)) &&
          (options.from === undefined || slot.startAt.getTime() >= options.from.getTime()),
      )
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

    return options.limit === undefined ? matching : matching.slice(0, options.limit);
  }

  async deleteIfOpen(id: string): Promise<string | null> {
    const slot = this.slots.get(id);
    if (!slot || slot.status !== 'OPEN') {
      return null;
    }
    this.slots.delete(id);
    return id;
  }

  async claimByRange(
    providerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<AvailabilitySlot | null> {
    const candidate = [...this.slots.values()]
      .filter(
        (slot) =>
          slot.providerId === providerId &&
          slot.status === 'OPEN' &&
          slot.startAt.getTime() <= startAt.getTime() &&
          slot.endAt.getTime() >= endAt.getTime(),
      )
      .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())[0];

    if (!candidate) {
      return null;
    }

    const claimed: AvailabilitySlot = { ...candidate, status: 'BOOKED' };
    this.slots.set(candidate.id, claimed);
    return claimed;
  }

  async releaseByRange(
    providerId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<AvailabilitySlot | null> {
    const booked = [...this.slots.values()].find(
      (slot) =>
        slot.providerId === providerId &&
        slot.status === 'BOOKED' &&
        slot.startAt.getTime() <= startAt.getTime() &&
        slot.endAt.getTime() >= endAt.getTime(),
    );
    if (!booked) {
      return null;
    }

    const released: AvailabilitySlot = { ...booked, status: 'OPEN' };
    this.slots.set(booked.id, released);
    return released;
  }

  /** Test seam: put a slot in a state only a booking produces. */
  async forceStatus(id: string, status: AvailabilityStatus): Promise<AvailabilitySlot> {
    const slot = this.slots.get(id);
    if (!slot) {
      throw new Error(`unknown slot ${id}`);
    }
    const updated: AvailabilitySlot = { ...slot, status };
    this.slots.set(id, updated);
    return updated;
  }
}

/** Discovery gate (T010) as availability sees it: on/off, nothing else. */
export class FakeDiscoverableDirectory implements ProviderDirectory {
  constructor(private readonly discoverable: boolean) {}

  async search(): Promise<ProviderSearchPage> {
    return { hits: [], total: 0 };
  }

  async findDiscoverable(providerId: string): Promise<ProviderDetail | null> {
    if (!this.discoverable) {
      return null;
    }
    return {
      provider: {
        id: providerId,
        userId: 'user-1',
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
