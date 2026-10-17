import { Inject, Injectable } from '@nestjs/common';

import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { PROVIDER_DIRECTORY } from '../../discovery/domain/provider-directory';
import type { ProviderDirectory } from '../../discovery/domain/provider-directory';
import type { ProviderType } from '../../provider/domain/provider-profile.model';
import { ProviderApplicationService } from '../../provider/application/provider-application.service';
import { providerNotFound } from '../../provider/domain/provider.errors';
import {
  slotForbidden,
  slotInvalidState,
  slotNotFound,
  slotUnavailable,
} from '../domain/availability.errors';
import {
  MAX_PUBLIC_SLOTS,
  assertSlotWindow,
  normalizeRecurrenceRule,
} from '../domain/availability-policy';
import { AVAILABILITY_SLOT_REPOSITORY } from '../domain/availability-slot.repository';
import type { AvailabilitySlotRepository } from '../domain/availability-slot.repository';
import type { SlotBooking } from '../domain/availability-slot.model';

export interface CreateSlotCommand {
  startAt: Date;
  endAt: Date;
  recurrenceRule?: string | null;
}

/**
 * Provider availability (`specs/05-api-spec.md` §Availability).
 *
 * Two different callers, two different rules:
 * - a provider manages their own slots (`POST`/`DELETE /providers/me/availability`);
 * - anyone may read the bookable slots of a *discoverable* provider, and a
 *   booking (T013) claims one through {@link claim}.
 *
 * The claim is the invariant: a booking consumes one whole slot, slots of a
 * provider never overlap, and the claim itself is a conditional UPDATE, so two
 * concurrent bookings for the same time produce exactly one winner.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(AVAILABILITY_SLOT_REPOSITORY) private readonly slots: AvailabilitySlotRepository,
    @Inject(ProviderApplicationService)
    private readonly applications: ProviderApplicationService,
    @Inject(PROVIDER_DIRECTORY) private readonly directory: ProviderDirectory,
  ) {}

  /** `POST /providers/me/availability`. */
  async createSlot(userId: string, providerType: ProviderType, input: CreateSlotCommand) {
    // No career availability exists while the career marketplace is off (T021).
    await this.applications.assertMarketplaceOpen(providerType);
    const { profile } = await this.applications.getMyApplication(userId, providerType);

    const window = assertSlotWindow(input.startAt, input.endAt, new Date());
    const recurrenceRule = normalizeRecurrenceRule(input.recurrenceRule);

    return this.slots.create({
      providerId: profile.id,
      startAt: window.startAt,
      endAt: window.endAt,
      recurrenceRule,
    });
  }

  /** `GET /providers/:id/availability`: bookable slots of a discoverable provider. */
  async listBookable(providerId: string) {
    if (!(await this.isDiscoverable(providerId))) {
      throw providerNotFound('Provider not found.');
    }

    return this.slots.listByProvider(providerId, {
      statuses: ['OPEN'],
      from: new Date(),
      limit: MAX_PUBLIC_SLOTS,
    });
  }

  /** `DELETE /providers/me/availability/:id`: an open, own slot only. */
  async deleteSlot(userId: string, providerType: ProviderType, slotId: string): Promise<string> {
    const { profile } = await this.applications.getMyApplication(userId, providerType);

    if (!isUuid(slotId)) {
      throw slotNotFound();
    }
    const slot = await this.slots.findById(slotId);
    if (!slot) {
      throw slotNotFound();
    }
    if (slot.providerId !== profile.id) {
      throw slotForbidden('This availability slot belongs to another provider.');
    }
    if (slot.status !== 'OPEN') {
      throw slotInvalidState(
        `An availability slot in status ${slot.status} cannot be deleted; a confirmed booking keeps its slot.`,
      );
    }

    const deleted = await this.slots.deleteIfOpen(slot.id);
    if (!deleted) {
      // It became booked between the check and the delete.
      throw slotInvalidState('This availability slot was just booked and cannot be deleted.');
    }
    return deleted;
  }

  /**
   * Book the slot covering a time window (T013).
   *
   * Raises `slotUnavailable` when nothing bookable covers the window, which
   * includes the "it overlaps a confirmed booking" case: a booked slot is no
   * longer `OPEN`, so it is never returned twice.
   */
  async claim(input: { providerId: string; startAt: Date; endAt: Date }): Promise<SlotBooking> {
    const slot = await this.slots.claimByRange(input.providerId, input.startAt, input.endAt);
    if (!slot) {
      throw slotUnavailable();
    }
    return {
      slotId: slot.id,
      providerId: slot.providerId,
      startAt: slot.startAt,
      endAt: slot.endAt,
    };
  }

  /** Give a booked window back (`BOOKED -> OPEN`), for cancellations (T016). */
  async release(input: { providerId: string; startAt: Date; endAt: Date }): Promise<boolean> {
    return (await this.slots.releaseByRange(input.providerId, input.startAt, input.endAt)) !== null;
  }

  /** Discovery (T010) decides who is public; availability never re-decides it. */
  private async isDiscoverable(providerId: string): Promise<boolean> {
    if (!isUuid(providerId)) {
      return false;
    }
    return (await this.directory.findDiscoverable(providerId)) !== null;
  }
}
