import type { DeliveryModeName, ProviderSortName, ProviderTypeName } from '@mentor/api-contracts';
import { DELIVERY_MODES, PROVIDER_SORTS } from '@mentor/api-contracts';

/**
 * Search filters for `GET /providers` (T030).
 *
 * These are exactly the filters the API documents — no keyword, no full-text
 * field, because the server does not implement one (`specs/05` §Discovery).
 * Inventing a client-side "search" that silently drops results would be worse
 * than showing the filters that really exist.
 */
export interface ProviderFilter {
  domain: ProviderTypeName;
  city: string;
  subject: string;
  grade: string;
  deliveryMode: DeliveryModeName | '';
  verifiedOnly: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  sort: ProviderSortName;
}

export const DEFAULT_FILTER: ProviderFilter = {
  domain: 'TUTORING',
  city: '',
  subject: '',
  grade: '',
  deliveryMode: '',
  verifiedOnly: false,
  minPrice: null,
  maxPrice: null,
  sort: 'relevance',
};

function isDeliveryMode(value: string): value is DeliveryModeName {
  return (DELIVERY_MODES as readonly string[]).includes(value);
}

function isSort(value: string): value is ProviderSortName {
  return (PROVIDER_SORTS as readonly string[]).includes(value);
}

function isMoney(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Clean up what a user typed.
 *
 * Codes are upper case server-side (`specs/04`), so they are normalised here;
 * an unknown delivery mode or sort falls back to the default instead of
 * producing a request the server would refuse with `VALIDATION_ERROR`.
 */
export function normalizeFilter(filter: Partial<ProviderFilter> = {}): ProviderFilter {
  const merged: ProviderFilter = { ...DEFAULT_FILTER, ...filter };

  const city = merged.city.trim().toUpperCase();
  const subject = merged.subject.trim().toUpperCase();
  const grade = merged.grade.trim().toUpperCase();

  let minPrice = isMoney(merged.minPrice) ? Math.trunc(merged.minPrice) : null;
  let maxPrice = isMoney(merged.maxPrice) ? Math.trunc(merged.maxPrice) : null;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    // A range the user inverted is dropped rather than silently swapped.
    minPrice = null;
    maxPrice = null;
  }

  return {
    domain: merged.domain === 'CAREER' ? 'CAREER' : 'TUTORING',
    city,
    subject,
    grade,
    deliveryMode: isDeliveryMode(merged.deliveryMode) ? merged.deliveryMode : '',
    verifiedOnly: merged.verifiedOnly === true,
    minPrice,
    maxPrice,
    sort: isSort(merged.sort) ? merged.sort : 'relevance',
  };
}

/** The filter as the API expects it: empty values are simply not sent. */
export function toSearchQuery(filter: ProviderFilter): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = { domain: filter.domain };

  if (filter.city.length > 0) {
    query.city = filter.city;
  }
  if (filter.subject.length > 0) {
    query.subject = filter.subject;
  }
  if (filter.grade.length > 0) {
    query.grade = filter.grade;
  }
  if (filter.deliveryMode.length > 0) {
    query.deliveryMode = filter.deliveryMode;
  }
  if (filter.verifiedOnly) {
    query.verifiedOnly = true;
  }
  if (filter.minPrice !== null) {
    query.minPrice = filter.minPrice;
  }
  if (filter.maxPrice !== null) {
    query.maxPrice = filter.maxPrice;
  }
  if (filter.sort !== 'relevance') {
    query.sort = filter.sort;
  }

  return query;
}

export function isDefaultFilter(filter: ProviderFilter): boolean {
  return JSON.stringify(normalizeFilter(filter)) === JSON.stringify(DEFAULT_FILTER);
}

/** How many filters are in play: the badge on the filter button. */
export function activeFilterCount(filter: ProviderFilter): number {
  return Object.keys(toSearchQuery(filter)).filter((key) => key !== 'domain' && key !== 'sort')
    .length;
}

/** Human-readable chips, so a user can see what narrowed the list. */
export function filterSummary(filter: ProviderFilter): string[] {
  const chips: string[] = [];
  if (filter.city.length > 0) {
    chips.push(`城市 ${filter.city}`);
  }
  if (filter.subject.length > 0) {
    chips.push(`科目 ${filter.subject}`);
  }
  if (filter.grade.length > 0) {
    chips.push(`年级 ${filter.grade}`);
  }
  if (filter.deliveryMode.length > 0) {
    chips.push(`方式 ${filter.deliveryMode}`);
  }
  if (filter.verifiedOnly) {
    chips.push('仅已验证');
  }
  if (filter.minPrice !== null || filter.maxPrice !== null) {
    const min = filter.minPrice ?? 0;
    const max = filter.maxPrice;
    chips.push(max === null ? `≥ ${min / 100} 元` : `${min / 100}–${max / 100} 元`);
  }
  return chips;
}
