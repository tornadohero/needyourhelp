import { describe, expect, it } from 'vitest';

import {
  MAX_SLOT_MINUTES,
  MIN_SLOT_MINUTES,
  assertSlotWindow,
  findOverlap,
  normalizeRecurrenceRule,
  overlaps,
} from '../../../src/modules/availability/domain/availability-policy';
import type { AvailabilitySlot } from '../../../src/modules/availability/domain/availability-slot.model';

const NOW = new Date('2026-10-01T00:00:00.000Z');

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function slot(
  id: string,
  startMinutes: number,
  endMinutes: number,
  status: AvailabilitySlot['status'] = 'OPEN',
): AvailabilitySlot {
  return {
    id,
    providerId: 'provider-1',
    startAt: at(startMinutes),
    endAt: at(endMinutes),
    recurrenceRule: null,
    status,
  };
}

describe('availability policy', () => {
  it('accepts a window in the future and inside the bounds', () => {
    const window = assertSlotWindow(at(60), at(120), NOW);

    expect(window.startAt.toISOString()).toBe(at(60).toISOString());
    expect(assertSlotWindow(at(0), at(MAX_SLOT_MINUTES), NOW).endAt.getTime() - NOW.getTime()).toBe(
      MAX_SLOT_MINUTES * 60_000,
    );
  });

  it('rejects an impossible or out-of-bounds window', () => {
    expect(() => assertSlotWindow(new Date('nope'), at(60), NOW)).toThrow(/ISO-8601/);
    expect(() => assertSlotWindow(at(120), at(60), NOW)).toThrow(/end after it starts/);
    expect(() => assertSlotWindow(at(60), at(60), NOW)).toThrow(/end after it starts/);
    expect(() => assertSlotWindow(at(60), at(60 + MIN_SLOT_MINUTES - 1), NOW)).toThrow(/minutes/);
    expect(() => assertSlotWindow(at(60), at(60 + MAX_SLOT_MINUTES + 1), NOW)).toThrow(/minutes/);
  });

  it('rejects a slot in the past', () => {
    // A window that is otherwise valid, but already over.
    const start = new Date(NOW.getTime() - 120 * 60_000);
    const end = new Date(NOW.getTime() - 60 * 60_000);
    expect(() => assertSlotWindow(start, end, NOW)).toThrow(/past/);
  });

  it('stores an empty recurrence rule as null', () => {
    expect(normalizeRecurrenceRule(undefined)).toBeNull();
    expect(normalizeRecurrenceRule('   ')).toBeNull();
    expect(normalizeRecurrenceRule(' FREQ=WEEKLY;BYDAY=MO ')).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(() => normalizeRecurrenceRule('R'.repeat(256))).toThrow(/recurrence/);
  });

  it('treats touching windows as free and intersecting ones as overlap', () => {
    // Half-open: [0,60) and [60,120) do not overlap.
    expect(overlaps({ startAt: at(0), endAt: at(60) }, { startAt: at(60), endAt: at(120) })).toBe(
      false,
    );
    expect(overlaps({ startAt: at(0), endAt: at(61) }, { startAt: at(60), endAt: at(120) })).toBe(
      true,
    );
    // Containment is an overlap too.
    expect(overlaps({ startAt: at(0), endAt: at(240) }, { startAt: at(60), endAt: at(120) })).toBe(
      true,
    );
  });

  it('finds an overlap only against OPEN or BOOKED slots', () => {
    const booked = slot('slot-1', 60, 120, 'BOOKED');
    const blocked = slot('slot-2', 60, 120, 'BLOCKED');

    expect(findOverlap([booked], { startAt: at(90), endAt: at(150) })?.id).toBe('slot-1');
    // Time the provider withheld may be crossed: it is never bookable anyway.
    expect(findOverlap([blocked], { startAt: at(90), endAt: at(150) })).toBeNull();
    expect(findOverlap([booked], { startAt: at(120), endAt: at(180) })).toBeNull();
  });
});
