import { complianceInvalidState } from './compliance.errors';

/**
 * Scope of a `RESTRICTED` compliance decision
 * (`specs/06-verification-state-machine.md` §Teacher compliance: "Restriction
 * can be category/time/location specific through `restriction_json`").
 *
 * Semantics are an allowlist: every dimension that is present must be matched
 * by the service; an absent dimension is not checked. A restriction with no
 * dimension grants nothing — `RESTRICTED` is never a blank cheque.
 *
 * Reviewer notes are deliberately absent: they live in the audit row of the
 * decision (`specs/06` §Admin decision requirements) and are never exposed
 * (`AGENTS.md` §9).
 */
export type ComplianceRestriction = {
  /** Category: taxonomy codes (subject/skill) the teacher may teach. */
  allowedSubjectCodes?: string[];
  /** Location: city codes where the service may be delivered. */
  allowedCityCodes?: string[];
  /** Time: last instant at which the restriction still permits the service. */
  allowedUntil?: string | null;
};

/**
 * What the compliance gate needs to know about the service being ordered.
 *
 * Services are owned by T009 and orders by T013: the caller resolves the
 * service and passes the facts compliance is allowed to judge.
 */
export interface ServiceComplianceContext {
  /** Taxonomy codes of the service (category). */
  subjectCodes?: readonly string[];
  /** Delivery location of the service. */
  cityCode?: string | null;
  /** When the service would happen; defaults to now for the time dimension. */
  at?: Date;
}

/** Taxonomy/city codes: uppercase slug, matching `taxonomy_terms.code`. */
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const MAX_CODES = 100;

/**
 * Validate and normalize an admin-supplied restriction.
 *
 * Throws on an unusable payload: a restriction must grant at least one
 * dimension, otherwise `RESTRICTED` would be indistinguishable from a refusal.
 */
export function normalizeRestriction(input: ComplianceRestriction): ComplianceRestriction {
  const subjectCodes = normalizeCodes(input.allowedSubjectCodes, 'allowedSubjectCodes');
  const cityCodes = normalizeCodes(input.allowedCityCodes, 'allowedCityCodes');
  const allowedUntil = normalizeUntil(input.allowedUntil);

  if (subjectCodes === undefined && cityCodes === undefined && allowedUntil === undefined) {
    throw complianceInvalidState(
      'A restriction must specify at least one of allowedSubjectCodes, allowedCityCodes or allowedUntil.',
    );
  }

  return {
    ...(subjectCodes === undefined ? {} : { allowedSubjectCodes: subjectCodes }),
    ...(cityCodes === undefined ? {} : { allowedCityCodes: cityCodes }),
    ...(allowedUntil === undefined ? {} : { allowedUntil }),
  };
}

/**
 * Read a stored restriction defensively.
 *
 * The column is `jsonb`, so the row can hold anything; an unusable payload is
 * treated as "no permission" instead of throwing on the read path.
 */
export function parseRestriction(raw: unknown): ComplianceRestriction | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;

  try {
    return normalizeRestriction({
      allowedSubjectCodes: Array.isArray(value.allowedSubjectCodes)
        ? (value.allowedSubjectCodes as string[])
        : undefined,
      allowedCityCodes: Array.isArray(value.allowedCityCodes)
        ? (value.allowedCityCodes as string[])
        : undefined,
      allowedUntil: typeof value.allowedUntil === 'string' ? value.allowedUntil : undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Whether a restriction permits a specific service.
 *
 * A `null` restriction (or one this service cannot satisfy) denies: a
 * restricted capability may only be ordered inside its granted scope.
 */
export function restrictionPermits(
  restriction: ComplianceRestriction | null,
  context: ServiceComplianceContext,
): boolean {
  if (!restriction) {
    return false;
  }

  const subjectCodes = restriction.allowedSubjectCodes;
  if (subjectCodes && subjectCodes.length > 0) {
    const serviceCodes = context.subjectCodes ?? [];
    if (!serviceCodes.some((code) => subjectCodes.includes(code))) {
      return false;
    }
  }

  const cityCodes = restriction.allowedCityCodes;
  if (cityCodes && cityCodes.length > 0) {
    if (!context.cityCode || !cityCodes.includes(context.cityCode)) {
      return false;
    }
  }

  if (restriction.allowedUntil) {
    const until = Date.parse(restriction.allowedUntil);
    if (Number.isNaN(until)) {
      return false;
    }
    if ((context.at ?? new Date()).getTime() > until) {
      return false;
    }
  }

  // Every present dimension matched, and at least one dimension was present
  // (guaranteed by `normalizeRestriction`).
  return true;
}

function normalizeCodes(value: string[] | undefined, field: string): string[] | undefined {
  // An empty allowlist grants nothing, so it is not a dimension at all.
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (value.length > MAX_CODES) {
    throw complianceInvalidState(`${field} accepts at most ${MAX_CODES} codes.`);
  }

  const codes = value.map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''));
  for (const code of codes) {
    if (!CODE_PATTERN.test(code)) {
      throw complianceInvalidState(`${field} contains an invalid code.`);
    }
  }
  return [...new Set(codes)];
}

function normalizeUntil(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw complianceInvalidState('allowedUntil must be an ISO-8601 timestamp.');
  }
  return new Date(parsed).toISOString();
}
