import { normalizeTaxonomyCode } from '../../catalog/domain/taxonomy-policy';
import { serviceInvalidState } from './service.errors';
import type { ServiceDomain, ServiceStatus, ServiceTermRef } from './service.model';

/**
 * What the server accepts for a sellable service
 * (`specs/01-business-rules.md` §Service: "Price is server authoritative";
 * T009 acceptance: "server validates price/duration").
 *
 * The bounds are configuration, not client input: they keep nonsense values out
 * of the catalogue, and they are the single place to change when platform rules
 * become configurable (T019). An order snapshots the price, so a value that
 * passes here is also the value a customer is charged.
 */

/** Minutes: shorter than this is not a session, longer than this is not one either. */
export const MIN_SERVICE_DURATION_MINUTES = 15;
export const MAX_SERVICE_DURATION_MINUTES = 480;

/** Integer minor units (cents). Money is never a float (`AGENTS.md` §8). */
export const MIN_SERVICE_PRICE_MINOR = 100;
export const MAX_SERVICE_PRICE_MINOR = 1_000_000;

export const MAX_SERVICE_TITLE_LENGTH = 120;
export const MAX_SERVICE_DESCRIPTION_LENGTH = 2000;

/** Bounded so a service cannot be tagged with the whole vocabulary. */
export const MAX_TERMS_PER_TYPE = 20;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function assertDurationMinutes(value: number): number {
  if (!Number.isInteger(value)) {
    throw serviceInvalidState('A service duration must be a whole number of minutes.');
  }
  if (value < MIN_SERVICE_DURATION_MINUTES || value > MAX_SERVICE_DURATION_MINUTES) {
    throw serviceInvalidState(
      `A service duration must be between ${MIN_SERVICE_DURATION_MINUTES} and ${MAX_SERVICE_DURATION_MINUTES} minutes.`,
    );
  }
  return value;
}

export function assertPriceMinor(value: number): number {
  if (!Number.isInteger(value)) {
    throw serviceInvalidState('A service price must be a whole number of minor units.');
  }
  if (value < MIN_SERVICE_PRICE_MINOR || value > MAX_SERVICE_PRICE_MINOR) {
    throw serviceInvalidState(
      `A service price must be between ${MIN_SERVICE_PRICE_MINOR} and ${MAX_SERVICE_PRICE_MINOR} minor units.`,
    );
  }
  return value;
}

export function assertTitle(value: string): string {
  const title = value.trim();
  if (title.length === 0 || title.length > MAX_SERVICE_TITLE_LENGTH) {
    throw serviceInvalidState(`A service title must be 1-${MAX_SERVICE_TITLE_LENGTH} characters.`);
  }
  return title;
}

export function assertDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const description = value.trim();
  if (description.length === 0) {
    return null;
  }
  if (description.length > MAX_SERVICE_DESCRIPTION_LENGTH) {
    throw serviceInvalidState(
      `A service description must be at most ${MAX_SERVICE_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
}

export function assertCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw serviceInvalidState('A service currency must be a 3-letter code.');
  }
  return currency;
}

/**
 * Normalize taxonomy codes supplied for the tags of a service.
 *
 * Same normalization as the taxonomy itself (T008), so a code typed in any case
 * still resolves, and duplicates collapse.
 */
export function normalizeTermCodes(codes: readonly string[] | undefined): string[] {
  if (codes === undefined) {
    return [];
  }
  if (codes.length > MAX_TERMS_PER_TYPE) {
    throw serviceInvalidState(
      `A service cannot carry more than ${MAX_TERMS_PER_TYPE} tags of one type.`,
    );
  }
  return [...new Set(codes.map((code) => normalizeTaxonomyCode(code)))];
}

/**
 * Every service has to say what it offers before it is sellable
 * (`specs/01-business-rules.md` §Service: "category, subjects/skills";
 * `specs/00-product-spec.md` §Career Mentor: "Publish expertise").
 *
 * A tutoring service names at least one subject; a career service names at least
 * one skill — the expertise a mentor is consulted for. The rule is per domain,
 * so neither marketplace can publish an untagged offer.
 */
export function assertTagging(domain: ServiceDomain, terms: readonly ServiceTermRef[]): void {
  if (domain === 'CAREER') {
    if (!terms.some((term) => term.type === 'SKILL')) {
      throw serviceInvalidState('A career service must name at least one skill.');
    }
    return;
  }

  if (!terms.some((term) => term.type === 'SUBJECT')) {
    throw serviceInvalidState('A tutoring service must name at least one subject.');
  }
}

// ---------------------------------------------------------------------------
// Publication state machine
// ---------------------------------------------------------------------------

/**
 * `specs/06-verification-state-machine.md` §Service publication:
 *
 * ```text
 * DRAFT -> PENDING_REVIEW -> PUBLISHED
 *                          -> REJECTED -> DRAFT
 * PUBLISHED -> UNPUBLISHED
 * ```
 *
 * `PENDING_REVIEW` and `REJECTED` belong to an admin service review that V1 has
 * no endpoint for (the API spec lists provider routes only, and
 * `specs/12-admin-spec.md` only audits a "service publication override"), so the
 * self-service publish command goes straight to `PUBLISHED`: the review gate for
 * a service is the approved provider (`specs/01` §Provider approval).
 */
export const SERVICE_TRANSITIONS: Record<ServiceStatus, readonly ServiceStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'PUBLISHED'],
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['UNPUBLISHED'],
  REJECTED: ['DRAFT', 'PUBLISHED'],
  UNPUBLISHED: ['PUBLISHED'],
};

export function canTransition(from: ServiceStatus, to: ServiceStatus): boolean {
  return SERVICE_TRANSITIONS[from].includes(to);
}

/**
 * A published service is what a customer sees and what an order snapshots, so
 * it is edited only after it is taken down: publish -> edit would silently
 * change a price a customer may already be looking at.
 */
export function isEditable(status: ServiceStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED' || status === 'UNPUBLISHED';
}

export function isPublished(status: ServiceStatus): boolean {
  return status === 'PUBLISHED';
}
