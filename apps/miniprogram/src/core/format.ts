/**
 * Display formatting (T028).
 *
 * Money is **integer minor units** everywhere in this platform (`AGENTS.md` §8):
 * the client never computes a price, it only formats what the server decided.
 * Times arrive as ISO-8601 UTC and are shown in the device's timezone.
 */

/** 20000 → "¥200.00". Never parses floats, never rounds a server value. */
export function formatMoney(minor: number, currency = '¥'): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(minor));
  const yuan = Math.floor(absolute / 100);
  const cents = absolute % 100;
  return `${sign}${currency}${yuan.toFixed(0)}.${String(cents).padStart(2, '0')}`;
}

/** 20000 → "200.00" (no symbol), for inputs and dense lists. */
export function formatAmount(minor: number): string {
  return formatMoney(minor, '');
}

/** "2026-10-20T03:51:24.231Z" → "2026-10-20 11:51". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${pad(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** "2026-10-20" for a date-only field such as a birth year or a slot day. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${pad(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Duration in minutes → "1 小时" / "45 分钟". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
