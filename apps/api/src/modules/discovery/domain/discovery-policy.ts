import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { providerInvalidState, providerNotFound } from '../../provider/domain/provider.errors';
import { MAX_SERVICE_PRICE_MINOR } from '../../services/domain/service-policy';
import type { ProviderSearchQuery, ProviderSort } from './provider-search.model';

/**
 * What `GET /providers` accepts.
 *
 * The API spec names the filters but neither their bounds nor the `sort`
 * values, so the server fixes them: a public listing is always bounded and
 * never scans the whole table.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** A price filter is minor units and can never be negative. */
export const MIN_PRICE_FILTER_MINOR = 0;
export const MAX_PRICE_FILTER_MINOR = MAX_SERVICE_PRICE_MINOR;

const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Filters as they arrive from the HTTP layer, before the server fixes them. */
export interface RawProviderSearchQuery {
  domain?: string;
  city?: string;
  providerType?: string;
  subject?: string;
  grade?: string;
  deliveryMode?: string;
  minPrice?: number;
  maxPrice?: number;
  verifiedOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

const DOMAINS: readonly string[] = ['TUTORING', 'CAREER'];
const CAPABILITY_TYPES: readonly string[] = [
  'STUDENT_TUTOR',
  'GRADUATE_TUTOR',
  'PHD_TUTOR',
  'TEACHER',
  'CAREER_MENTOR',
];
const DELIVERY_MODES: readonly string[] = ['ONLINE', 'OFFLINE', 'HYBRID'];
const SORTS: readonly string[] = ['relevance', 'rating', 'newest'];

/**
 * Normalize and validate a search query.
 *
 * Every filter is a hard constraint (`specs/16-ai-matching-spec.md` §Retrieval);
 * the ordering afterwards is the V1 ranking of `specs/01-business-rules.md`.
 */
export function normalizeSearchQuery(input: RawProviderSearchQuery): ProviderSearchQuery {
  const page = assertPage(input.page);
  const pageSize = assertPageSize(input.pageSize);
  const minPriceMinor = assertPriceFilter(input.minPrice, 'minPrice');
  const maxPriceMinor = assertPriceFilter(input.maxPrice, 'maxPrice');

  if (minPriceMinor !== null && maxPriceMinor !== null && minPriceMinor > maxPriceMinor) {
    throw providerInvalidState('minPrice must not be greater than maxPrice.');
  }

  if (input.domain !== undefined && !DOMAINS.includes(input.domain)) {
    throw providerInvalidState(`Unknown domain ${input.domain}.`);
  }
  if (input.providerType !== undefined && !CAPABILITY_TYPES.includes(input.providerType)) {
    throw providerInvalidState(`Unknown providerType ${input.providerType}.`);
  }
  if (input.deliveryMode !== undefined && !DELIVERY_MODES.includes(input.deliveryMode)) {
    throw providerInvalidState(`Unknown deliveryMode ${input.deliveryMode}.`);
  }
  if (input.sort !== undefined && !SORTS.includes(input.sort)) {
    throw providerInvalidState(`Unknown sort ${input.sort}.`);
  }

  return {
    domain: (input.domain as ProviderSearchQuery['domain']) ?? 'TUTORING',
    cityCode: normalizeCode(input.city, 'city'),
    capabilityType: (input.providerType as ProviderSearchQuery['capabilityType']) ?? null,
    subjectCode: normalizeCode(input.subject, 'subject'),
    gradeCode: normalizeCode(input.grade, 'grade'),
    deliveryMode: (input.deliveryMode as ProviderSearchQuery['deliveryMode']) ?? null,
    minPriceMinor,
    maxPriceMinor,
    verifiedOnly: input.verifiedOnly === true,
    page,
    pageSize,
    sort: (input.sort as ProviderSort) ?? 'relevance',
  };
}

/** A provider id is opaque: an unparseable one is simply not found. */
export function assertProviderId(id: string): string {
  if (!isUuid(id)) {
    throw providerNotFound('Provider not found.');
  }
  return id;
}

function assertPage(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw providerInvalidState('page must be a positive integer.');
  }
  return value;
}

function assertPageSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw providerInvalidState(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

function assertPriceFilter(value: number | undefined, field: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (
    !Number.isInteger(value) ||
    value < MIN_PRICE_FILTER_MINOR ||
    value > MAX_PRICE_FILTER_MINOR
  ) {
    throw providerInvalidState(
      `${field} must be an integer between ${MIN_PRICE_FILTER_MINOR} and ${MAX_PRICE_FILTER_MINOR}.`,
    );
  }
  return value;
}

/** Codes are upper-cased so a filter typed in any case still matches. */
function normalizeCode(value: string | undefined, field: string): string | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }
  const code = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw providerInvalidState(`Invalid ${field} code.`);
  }
  return code;
}
