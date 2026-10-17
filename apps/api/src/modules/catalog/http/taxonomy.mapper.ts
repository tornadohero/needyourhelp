import type { AdminTaxonomyListResponse, TaxonomyTermResponse } from '@mentor/api-contracts';

import type { TaxonomyTerm, TaxonomyTermPage } from '../domain/taxonomy.model';

/**
 * Response mappers for the admin taxonomy.
 *
 * Built field by field (allowlist) instead of serializing ORM entities
 * (`AGENTS.md` §10). The taxonomy carries no internal note or audit detail, so
 * the same shape is safe for a future public read (T010).
 */
export function toTaxonomyTermResponse(term: TaxonomyTerm): TaxonomyTermResponse {
  return {
    id: term.id,
    type: term.type,
    code: term.code,
    name: term.name,
    parentId: term.parentId,
    active: term.active,
  };
}

export function toAdminTaxonomyListResponse(page: TaxonomyTermPage): AdminTaxonomyListResponse {
  return {
    items: page.items.map(toTaxonomyTermResponse),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
  };
}
