import { describe, expect, it } from 'vitest';

import { slotWindow, today } from './slot-form';

describe('slotWindow', () => {
  it('turns a wall-clock choice into the ISO pair the API speaks', () => {
    const window = slotWindow('2026-11-01', '19:00', 60);

    expect(window.startAt).toBe(new Date(2026, 10, 1, 19, 0, 0, 0).toISOString());
    expect(window.endAt).toBe(new Date(2026, 10, 1, 20, 0, 0, 0).toISOString());
  });

  it('ends later than it starts, whatever the duration', () => {
    const window = slotWindow('2026-11-01', '23:30', 90);

    expect(new Date(window.endAt).getTime()).toBeGreaterThan(new Date(window.startAt).getTime());
    // 23:30 + 90 minutes crosses midnight; the date must follow it.
    expect(new Date(window.endAt).getTime() - new Date(window.startAt).getTime()).toBe(90 * 60_000);
  });

  it('is a representation change only: the duration is exactly what was picked', () => {
    expect(
      new Date(slotWindow('2026-11-01', '09:15', 120).endAt).getTime() -
        new Date(slotWindow('2026-11-01', '09:15', 120).startAt).getTime(),
    ).toBe(120 * 60_000);
  });
});

describe('today', () => {
  it('is the picker’s initial value, in the device’s own calendar', () => {
    expect(today(new Date(2026, 9, 23, 12, 0, 0))).toBe('2026-10-23');
  });
});
