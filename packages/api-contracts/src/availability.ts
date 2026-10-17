/**
 * Availability contract (T011).
 *
 * Source of truth: `specs/05-api-spec.md` §Availability,
 * `specs/04-database-spec.md` §availability_slots,
 * `specs/01-business-rules.md` §Orders ("valid service availability") and
 * `specs/00-product-spec.md` §V1 scope ("basic create/list/delete").
 *
 * A slot is a time window a provider offers. A confirmed booking consumes one
 * slot, and slots of one provider never overlap, so two confirmed bookings can
 * never overlap either.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** `availability_slots.status`. */
export const AVAILABILITY_STATUSES = ['OPEN', 'BOOKED', 'BLOCKED'] as const;
export type AvailabilityStatusName = (typeof AVAILABILITY_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface AvailabilitySlotResponse {
  id: string;
  providerId: string;
  /** ISO-8601, UTC (`AGENTS.md` §5). */
  startAt: string;
  endAt: string;
  recurrenceRule: string | null;
  status: AvailabilityStatusName;
}

/** `GET /providers/:id/availability`: bookable slots only. */
export interface AvailabilityListResponse {
  items: AvailabilitySlotResponse[];
  total: number;
}

export interface AvailabilityDeletionResponse {
  id: string;
  deleted: boolean;
}
