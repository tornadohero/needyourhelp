/** Domain view of the catalog taxonomy. */

export type TaxonomyType = 'SUBJECT' | 'GRADE' | 'SKILL' | 'CITY';

export interface TaxonomyTerm {
  id: string;
  type: TaxonomyType;
  code: string;
  name: string;
  parentId: string | null;
  /** Terms are archived (`active=false`) instead of deleted. */
  active: boolean;
}

export interface CreateTaxonomyTermInput {
  type: TaxonomyType;
  code: string;
  name: string;
  parentId?: string | null;
}

/**
 * `PATCH /admin/taxonomy/:id`.
 *
 * `code` is deliberately absent: it is the stable key referenced by compliance
 * restrictions and order snapshots, so it never changes after creation.
 */
export interface UpdateTaxonomyTermInput {
  name?: string;
  parentId?: string | null;
  /**
   * Re-activating an archived term. The spec defines only the archive command,
   * so `PATCH` is the only recovery path that does not invent an endpoint.
   */
  active?: boolean;
}

/** Bounded page query for the admin listing. */
export interface TaxonomyTermQuery {
  type?: TaxonomyType;
  parentId?: string;
  active?: boolean;
  page: number;
  pageSize: number;
}

export interface TaxonomyTermPage {
  items: TaxonomyTerm[];
  page: number;
  pageSize: number;
  total: number;
}

/** Defaults for the admin listing: a page is always bounded. */
export const TAXONOMY_PAGE_DEFAULTS = { page: 1, pageSize: 20 } as const;
export const TAXONOMY_MAX_PAGE_SIZE = 100;
