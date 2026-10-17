import type {
  AvailabilitySlot,
  AvailabilityStatus,
  CreateSlotInput,
} from './availability-slot.model';

/** Dependency-injection token for {@link AvailabilitySlotRepository}. */
export const AVAILABILITY_SLOT_REPOSITORY = 'AVAILABILITY_SLOT_REPOSITORY';

/**
 * Persistence port for availability slots.
 *
 * The two booking operations are the reason this port exists: both are single
 * conditional statements, so the "no overlapping confirmed bookings" rule holds
 * even when two requests race (`specs/14-test-strategy.md`).
 */
export interface AvailabilitySlotRepository {
  /**
   * Insert a slot, refusing one that overlaps an existing `OPEN`/`BOOKED` slot
   * of the same provider.
   */
  create(input: CreateSlotInput): Promise<AvailabilitySlot>;

  findById(id: string): Promise<AvailabilitySlot | null>;

  /** Own slots, or the bookable ones for a public listing. */
  listByProvider(
    providerId: string,
    options?: { statuses?: readonly AvailabilityStatus[]; from?: Date; limit?: number },
  ): Promise<AvailabilitySlot[]>;

  /**
   * Delete an `OPEN` slot; `null` when it is gone or no longer open, so a
   * confirmed booking can never lose its slot.
   */
  deleteIfOpen(id: string): Promise<string | null>;

  /**
   * Book the slot that covers `[startAt, endAt)`.
   *
   * `OPEN -> BOOKED` in one conditional UPDATE: two concurrent claims produce
   * exactly one winner and the loser gets `null`.
   */
  claimByRange(providerId: string, startAt: Date, endAt: Date): Promise<AvailabilitySlot | null>;

  /** `BOOKED -> OPEN`: what a cancellation (T016) does. */
  releaseByRange(providerId: string, startAt: Date, endAt: Date): Promise<AvailabilitySlot | null>;
}
