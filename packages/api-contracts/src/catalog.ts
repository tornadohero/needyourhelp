/**
 * Catalog contract (T008).
 *
 * Source of truth: `specs/05-api-spec.md` §Taxonomy,
 * `specs/04-database-spec.md` §taxonomy_terms and
 * `specs/12-admin-spec.md` §Admin principles.
 *
 * The taxonomy is platform configuration: only an admin may change it, every
 * change is audited, and terms are archived (`active=false`) instead of deleted
 * because `service_terms` references them and historical orders depend on the
 * taxonomy snapshot.
 *
 * Every payload is an allowlist: ORM entities are never serialized
 * (`AGENTS.md` §10).
 */

/** Taxonomy term types (`specs/04-database-spec.md` §taxonomy_terms). */
export const TAXONOMY_TYPES = ['SUBJECT', 'GRADE', 'SKILL', 'CITY'] as const;

export type TaxonomyTypeName = (typeof TAXONOMY_TYPES)[number];

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * A taxonomy term.
 *
 * Admin-facing (management) today; the same shape is safe for a future public
 * read because it carries no internal note or audit detail.
 */
export interface TaxonomyTermResponse {
  id: string;
  type: TaxonomyTypeName;
  /** Stable machine key. Immutable: compliance restrictions reference codes. */
  code: string;
  name: string;
  parentId: string | null;
  /** Archived terms stay resolvable for history but are not selectable. */
  active: boolean;
}

/** `GET /admin/taxonomy`: a bounded page, never an unbounded scan. */
export interface AdminTaxonomyListResponse {
  items: TaxonomyTermResponse[];
  page: number;
  pageSize: number;
  total: number;
}
