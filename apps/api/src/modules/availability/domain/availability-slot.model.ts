/**
 * Domain view of a provider availability slot
 * (`specs/04-database-spec.md` §availability_slots,
 * `specs/02-domain-model.md` §Tutoring: "Availability").
 *
 * V1 is basic slot create/list/delete (`specs/00-product-spec.md` §V1 scope):
 * the recurrence rule is stored but never expanded — the calendar UI belongs to
 * V1.1.
 *
 * A slot is the unit a booking consumes: `OPEN` is bookable, `BOOKED` is taken
 * by a confirmed booking, `BLOCKED` is time the provider withheld.
 */

export type AvailabilityStatus = 'OPEN' | 'BOOKED' | 'BLOCKED';

export interface AvailabilitySlot {
  id: string;
  providerId: string;
  startAt: Date;
  endAt: Date;
  /** Stored verbatim, never expanded in V1. */
  recurrenceRule: string | null;
  status: AvailabilityStatus;
}

export interface CreateSlotInput {
  providerId: string;
  startAt: Date;
  endAt: Date;
  recurrenceRule: string | null;
}

/** What a booking (T013) consumes: one whole slot. */
export interface SlotBooking {
  slotId: string;
  providerId: string;
  startAt: Date;
  endAt: Date;
}
