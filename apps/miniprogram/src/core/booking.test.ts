import type { AvailabilitySlotResponse } from '@mentor/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  BookingIncompleteError,
  NOTE_MAX_LENGTH,
  bookingProblems,
  bookingRequest,
  newBookingDraft,
  slotOptions,
  withChild,
  withNote,
  withService,
  withSlot,
} from './booking';

function slot(overrides: Partial<AvailabilitySlotResponse> = {}): AvailabilitySlotResponse {
  return {
    id: 'slot-1',
    providerId: 'provider-1',
    startAt: '2026-11-01T02:00:00.000Z',
    endAt: '2026-11-01T03:00:00.000Z',
    recurrenceRule: null,
    status: 'OPEN',
    ...overrides,
  };
}

const NOW = new Date('2026-10-21T00:00:00.000Z');

describe('slotOptions', () => {
  it('offers only windows the provider still offers', () => {
    const options = slotOptions(
      [slot({ id: 'a', status: 'OPEN' }), slot({ id: 'b', status: 'BOOKED' })],
      NOW,
    );

    expect(options.map((option) => option.id)).toEqual(['a']);
    expect(options[0]?.selectable).toBe(true);
  });

  it('drops a window that has already passed', () => {
    const options = slotOptions(
      [slot({ id: 'old', startAt: '2026-10-01T02:00:00.000Z', endAt: '2026-10-01T03:00:00.000Z' })],
      NOW,
    );

    expect(options).toEqual([]);
  });

  it('offers the earliest window first', () => {
    const options = slotOptions(
      [
        slot({
          id: 'late',
          startAt: '2026-11-03T02:00:00.000Z',
          endAt: '2026-11-03T03:00:00.000Z',
        }),
        slot({
          id: 'early',
          startAt: '2026-11-01T02:00:00.000Z',
          endAt: '2026-11-01T03:00:00.000Z',
        }),
      ],
      NOW,
    );

    expect(options.map((option) => option.id)).toEqual(['early', 'late']);
  });

  it('carries the slot’s own times, not times the screen composed', () => {
    const options = slotOptions([slot()], NOW);

    expect(options[0]?.startAt).toBe('2026-11-01T02:00:00.000Z');
    expect(options[0]?.endAt).toBe('2026-11-01T03:00:00.000Z');
  });
});

describe('booking draft', () => {
  it('starts empty: nothing is chosen for the customer', () => {
    const draft = newBookingDraft('provider-1');

    expect(draft).toEqual({
      providerId: 'provider-1',
      serviceId: null,
      slotId: null,
      startAt: null,
      endAt: null,
      childId: null,
      note: '',
    });
  });

  it('forgets the window when the slot is cleared', () => {
    const draft = withSlot(withSlot(newBookingDraft('p'), slotOptions([slot()], NOW)[0]!), null);

    expect(draft.slotId).toBeNull();
    expect(draft.startAt).toBeNull();
    expect(draft.endAt).toBeNull();
  });

  it('cuts a note to the server’s limit instead of round-tripping a rejection', () => {
    const draft = withNote(newBookingDraft('p'), `  ${'x'.repeat(600)}  `);

    expect(draft.note.length).toBe(NOTE_MAX_LENGTH);
    expect(draft.note.startsWith('x')).toBe(true);
  });

  it('allows a booking with no child: a child is optional', () => {
    const draft = withChild(newBookingDraft('p'), null);
    expect(draft.childId).toBeNull();
  });
});

describe('bookingProblems', () => {
  it('asks for a service and a slot before anything is sent', () => {
    expect(bookingProblems(newBookingDraft('p'))).toEqual(['NO_SERVICE', 'NO_SLOT']);
  });

  it('is satisfied by a service, a slot and nothing else', () => {
    let draft = withService(newBookingDraft('p'), 'service-1');
    draft = withSlot(draft, slotOptions([slot()], NOW)[0]!);

    expect(bookingProblems(draft)).toEqual([]);
  });
});

describe('bookingRequest', () => {
  it('refuses an incomplete draft instead of sending it', () => {
    expect(() => bookingRequest(newBookingDraft('p'))).toThrow(BookingIncompleteError);

    try {
      bookingRequest(withService(newBookingDraft('p'), 'service-1'));
    } catch (error) {
      expect((error as BookingIncompleteError).problems).toEqual(['NO_SLOT']);
    }
  });

  it('sends no money: the server derives every amount', () => {
    let draft = withService(newBookingDraft('p'), 'service-1');
    draft = withSlot(draft, slotOptions([slot()], NOW)[0]!);

    const body = JSON.stringify(bookingRequest(draft));
    for (const forbidden of ['amount', 'price', 'fee', 'total', 'currency']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('sends exactly the fields the contract documents', () => {
    let draft = withService(newBookingDraft('p'), 'service-1');
    draft = withSlot(draft, slotOptions([slot()], NOW)[0]!);
    draft = withChild(draft, 'child-1');

    expect(bookingRequest(draft)).toEqual({
      serviceId: 'service-1',
      childId: 'child-1',
      scheduledStart: '2026-11-01T02:00:00.000Z',
      scheduledEnd: '2026-11-01T03:00:00.000Z',
    });
  });

  it('omits an empty note rather than sending one', () => {
    let draft = withService(newBookingDraft('p'), 'service-1');
    draft = withSlot(draft, slotOptions([slot()], NOW)[0]!);
    draft = withNote(draft, '   ');

    expect(bookingRequest(draft).note).toBeUndefined();
  });

  it('keeps a note that says something', () => {
    let draft = withService(newBookingDraft('p'), 'service-1');
    draft = withSlot(draft, slotOptions([slot()], NOW)[0]!);
    draft = withNote(draft, ' 周五晚上方便 ');

    expect(bookingRequest(draft).note).toBe('周五晚上方便');
  });
});
