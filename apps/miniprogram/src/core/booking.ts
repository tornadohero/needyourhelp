import type { AvailabilitySlotResponse } from '@mentor/api-contracts';

import { formatDateTime } from './format';

/**
 * Booking draft (T031) — `specs/11` §Parent pages: Create booking.
 *
 * A booking is what the customer wants: a service, a window the provider
 * actually offered, and optionally a child. It is never a price — the server
 * derives every amount (`specs/05-api-spec.md` §Orders: "Server derives price"),
 * and the request type below has no money field by construction.
 *
 * The window is copied from the chosen slot. A client that typed its own times
 * could ask for a slot the provider never published; the server would refuse it
 * anyway (T011 claims one whole slot), so the client does not try.
 */

/** Mirrors the server's `MAX_NOTE_LENGTH` (`apps/api` order policy). */
export const NOTE_MAX_LENGTH = 500;

export interface BookingDraft {
  providerId: string;
  serviceId: string | null;
  slotId: string | null;
  /** The slot's own `startAt` / `endAt`, ISO-8601 UTC. */
  startAt: string | null;
  endAt: string | null;
  childId: string | null;
  note: string;
}

export interface SlotOptionView {
  id: string;
  rangeText: string;
  startAt: string;
  endAt: string;
  /**
   * `false` for a slot that is already taken or in the past.
   *
   * The list from `GET /providers/:id/availability` is bookable slots only, but
   * a stale screen can hold a slot someone else booked since; the picker refuses
   * it locally instead of trading a 409 for a tap.
   */
  selectable: boolean;
}

export function newBookingDraft(providerId: string): BookingDraft {
  return {
    providerId,
    serviceId: null,
    slotId: null,
    startAt: null,
    endAt: null,
    childId: null,
    note: '',
  };
}

/**
 * The bookable windows, oldest first.
 *
 * `BOOKED` and `BLOCKED` slots are dropped rather than greyed out: a slot the
 * provider withdrew is not an offer, and showing it would invite a tap that can
 * only fail.
 */
export function slotOptions(
  slots: AvailabilitySlotResponse[],
  now: Date = new Date(),
): SlotOptionView[] {
  return slots
    .filter((slot) => slot.status === 'OPEN')
    .filter((slot) => new Date(slot.endAt).getTime() > now.getTime())
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .map((slot) => ({
      id: slot.id,
      rangeText: `${formatDateTime(slot.startAt)} – ${formatDateTime(slot.endAt)}`,
      startAt: slot.startAt,
      endAt: slot.endAt,
      selectable: true,
    }));
}

export function withService(draft: BookingDraft, serviceId: string | null): BookingDraft {
  return { ...draft, serviceId };
}

export function withSlot(draft: BookingDraft, slot: SlotOptionView | null): BookingDraft {
  if (slot === null) {
    return { ...draft, slotId: null, startAt: null, endAt: null };
  }
  return { ...draft, slotId: slot.id, startAt: slot.startAt, endAt: slot.endAt };
}

export function withChild(draft: BookingDraft, childId: string | null): BookingDraft {
  return { ...draft, childId };
}

/**
 * The note is trimmed and cut to the server's limit.
 *
 * Cutting here beats a `VALIDATION_ERROR` round trip, and the server still
 * validates: length is a contract, not a client convenience.
 */
export function withNote(draft: BookingDraft, note: string): BookingDraft {
  return { ...draft, note: note.trim().slice(0, NOTE_MAX_LENGTH) };
}

export type BookingProblem = 'NO_SERVICE' | 'NO_SLOT' | 'SLOT_NOT_OPEN' | 'NOTE_TOO_LONG';

export function bookingProblems(draft: BookingDraft): BookingProblem[] {
  const problems: BookingProblem[] = [];
  if (draft.serviceId === null) {
    problems.push('NO_SERVICE');
  }
  if (draft.slotId === null || draft.startAt === null || draft.endAt === null) {
    problems.push('NO_SLOT');
  }
  if (draft.note.length > NOTE_MAX_LENGTH) {
    problems.push('NOTE_TOO_LONG');
  }
  return problems;
}

export const BOOKING_PROBLEM_TEXTS: Record<BookingProblem, string> = {
  NO_SERVICE: '请选择要预约的服务。',
  NO_SLOT: '请选择可预约的时段。',
  SLOT_NOT_OPEN: '该时段已被预约，请另选一个。',
  NOTE_TOO_LONG: '备注过长，请精简后再提交。',
};

/** `POST /orders` — and nothing more: no price, no fee, no status, no provider. */
export interface CreateOrderBody {
  serviceId: string;
  childId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  note?: string;
}

/** Thrown when a draft is not complete enough to be a request. */
export class BookingIncompleteError extends Error {
  readonly problems: BookingProblem[];

  constructor(problems: BookingProblem[]) {
    super(`Booking is incomplete: ${problems.join(', ')}`);
    this.name = 'BookingIncompleteError';
    this.problems = problems;
  }
}

/**
 * Turn a draft into the request body.
 *
 * An empty note is dropped instead of sent as `''`: the field is optional, and
 * an omitted optional field is one less thing for the server to validate.
 */
export function bookingRequest(draft: BookingDraft): CreateOrderBody {
  const problems = bookingProblems(draft);
  if (problems.length > 0) {
    throw new BookingIncompleteError(problems);
  }

  // Trimmed again here: a draft is a mutable thing a screen owns, and a note of
  // spaces is not a note.
  const note = draft.note.trim();

  return {
    serviceId: draft.serviceId as string,
    childId: draft.childId,
    scheduledStart: draft.startAt as string,
    scheduledEnd: draft.endAt as string,
    ...(note.length > 0 ? { note } : {}),
  };
}
