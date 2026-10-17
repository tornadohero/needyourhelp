import type {
  AvailabilityDeletionResponse,
  AvailabilityListResponse,
  AvailabilitySlotResponse,
} from '@mentor/api-contracts';

import type { AvailabilitySlot } from '../domain/availability-slot.model';

/**
 * Response mappers for availability.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). Timestamps are ISO-8601 in UTC (`AGENTS.md` §5).
 */
export function toAvailabilitySlotResponse(slot: AvailabilitySlot): AvailabilitySlotResponse {
  return {
    id: slot.id,
    providerId: slot.providerId,
    startAt: slot.startAt.toISOString(),
    endAt: slot.endAt.toISOString(),
    recurrenceRule: slot.recurrenceRule,
    status: slot.status,
  };
}

export function toAvailabilityListResponse(
  slots: readonly AvailabilitySlot[],
): AvailabilityListResponse {
  return {
    items: slots.map(toAvailabilitySlotResponse),
    total: slots.length,
  };
}

export function toAvailabilityDeletionResponse(id: string): AvailabilityDeletionResponse {
  return { id, deleted: true };
}
