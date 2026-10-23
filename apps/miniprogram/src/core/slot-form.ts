/**
 * Availability form (T032) — `specs/11` §Provider pages：Availability.
 *
 * A provider picks a wall-clock window; the API speaks ISO-8601 UTC
 * (`AGENTS.md` §5). This is the only conversion in the client, and it is a
 * conversion of *representation*, not of meaning: the window the provider sees
 * is the window that is stored.
 *
 * What is deliberately not here is any overlap check. Slots of one provider
 * never overlap (T011 owns that invariant), and a rule copied to the client is a
 * rule that will drift from the one that is actually enforced.
 */

export interface SlotWindow {
  startAt: string;
  endAt: string;
}

/** "2026-11-01" + "19:00" + 60 → the ISO pair the server expects. */
export function slotWindow(day: string, time: string, durationMinutes: number): SlotWindow {
  return {
    startAt: toIso(day, time, 0),
    endAt: toIso(day, time, durationMinutes),
  };
}

/** Today, in the device's own calendar, for the picker's initial value. */
export function today(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toIso(day: string, time: string, addMinutes: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const local = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0, 0, 0);
  local.setMinutes(local.getMinutes() + addMinutes);
  return local.toISOString();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
