/**
 * Money primitives.
 *
 * Rule (AGENTS.md §8): all monetary values are integer minor units ( cents / fen ).
 * Floating point is never used for money.
 */

export type Minor = number & { readonly __brand: 'Minor' };

export const MINOR_UNITS_PER_MAJOR = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Convert a major-unit amount (e.g. 100 RMB) to minor units (10000 cents). */
export function toMinor(major: number): Minor {
  if (!Number.isFinite(major)) {
    throw new MoneyError('Major amount must be a finite number.');
  }
  const minor = Math.round(major * MINOR_UNITS_PER_MAJOR);
  return minor as Minor;
}

/** Convert minor units back to a major-unit number. Display only; never persist. */
export function fromMinor(minor: Minor): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/** Format minor units for display, e.g. 10000 -> "100.00". */
export function formatMinor(minor: Minor, currency = ''): string {
  const major = fromMinor(minor).toFixed(2);
  return currency ? `${currency} ${major}` : major;
}

export function addMinor(a: Minor, b: Minor): Minor {
  return (a + b) as Minor;
}

export function subtractMinor(a: Minor, b: Minor): Minor {
  return (a - b) as Minor;
}

/** Integer-only percentage: fee = round(minor * rateBp / 10000). */
export function applyRateBp(minor: Minor, rateBp: number): Minor {
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    throw new MoneyError('Rate must be a non-negative integer in basis points.');
  }
  return Math.round((minor * rateBp) / 10000) as Minor;
}

/**
 * Split an amount into `parts` integer minor units without losing a single unit.
 * Remainder is distributed to the first buckets, matching fee/payout rounding rules.
 */
export function allocateMinor(minor: Minor, parts: number): Minor[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError('Parts must be a positive integer.');
  }
  const base = Math.trunc(minor / parts);
  const remainder = minor - base * parts;
  return Array.from({ length: parts }, (_, i) => (base + (i < remainder ? 1 : 0)) as Minor);
}
