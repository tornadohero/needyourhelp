import { slotInvalidState } from './availability.errors';
import type { AvailabilitySlot, AvailabilityStatus } from './availability-slot.model';

/**
 * What the server accepts for a slot and what it guarantees
 * (`specs/01-business-rules.md` §Orders: an order needs "valid service
 * availability"; T011 acceptance: "no overlapping confirmed bookings").
 *
 * The invariant is enforced twice, on purpose:
 * 1. two slots of one provider never overlap — application check plus the
 *    `availability_slots_no_overlap` exclusion constraint in the database;
 * 2. a booking consumes exactly one whole slot, and claiming it is a single
 *    conditional UPDATE.
 *
 * Together that makes overlapping *confirmed bookings* impossible, not merely
 * unlikely.
 */

export const MIN_SLOT_MINUTES = 15;
export const MAX_SLOT_MINUTES = 24 * 60;

/** Stored, never expanded in V1 (`specs/00-product-spec.md` §V1.1). */
export const MAX_RECURRENCE_RULE_LENGTH = 255;

/** A public listing is always bounded (`specs/05-api-spec.md` has no paging). */
export const MAX_PUBLIC_SLOTS = 100;

export interface SlotWindow {
  startAt: Date;
  endAt: Date;
}

/**
 * Validate a time window: real dates, end after start, inside the bounds and
 * not in the past.
 */
export function assertSlotWindow(startAt: Date, endAt: Date, now: Date): SlotWindow {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw slotInvalidState('A slot needs a valid ISO-8601 start and end.');
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw slotInvalidState('A slot must end after it starts.');
  }

  const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (minutes < MIN_SLOT_MINUTES || minutes > MAX_SLOT_MINUTES) {
    throw slotInvalidState(
      `A slot must be between ${MIN_SLOT_MINUTES} and ${MAX_SLOT_MINUTES} minutes long.`,
    );
  }

  // Availability is always offered for the future.
  if (startAt.getTime() < now.getTime()) {
    throw slotInvalidState('A slot cannot start in the past.');
  }

  return { startAt, endAt };
}

/** An empty recurrence rule is stored as `null`, never as an empty string. */
export function normalizeRecurrenceRule(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const rule = value.trim();
  if (rule.length === 0) {
    return null;
  }
  if (rule.length > MAX_RECURRENCE_RULE_LENGTH) {
    throw slotInvalidState(
      `A recurrence rule must be at most ${MAX_RECURRENCE_RULE_LENGTH} characters.`,
    );
  }
  return rule;
}

/**
 * Half-open overlap: touching windows do not overlap
 * (`[aStart, aEnd)` against `[bStart, bEnd)`).
 */
export function overlaps(a: SlotWindow, b: SlotWindow): boolean {
  return a.startAt.getTime() < b.endAt.getTime() && a.endAt.getTime() > b.startAt.getTime();
}

/**
 * The statuses a new slot must not collide with.
 *
 * `BLOCKED` is excluded: blocking time inside an open slot is a legitimate
 * refinement, and it is never bookable anyway.
 */
export const CONFLICTING_STATUSES: readonly AvailabilityStatus[] = ['OPEN', 'BOOKED'];

export function findOverlap(
  existing: readonly AvailabilitySlot[],
  window: SlotWindow,
): AvailabilitySlot | null {
  return (
    existing.find(
      (slot) =>
        CONFLICTING_STATUSES.includes(slot.status) &&
        overlaps(window, { startAt: slot.startAt, endAt: slot.endAt }),
    ) ?? null
  );
}
