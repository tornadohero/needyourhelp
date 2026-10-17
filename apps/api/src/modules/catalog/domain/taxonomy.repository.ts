import type {
  CreateTaxonomyTermInput,
  TaxonomyTerm,
  TaxonomyTermPage,
  TaxonomyTermQuery,
  TaxonomyType,
  UpdateTaxonomyTermInput,
} from './taxonomy.model';

/** Dependency-injection token for {@link TaxonomyRepository}. */
export const TAXONOMY_REPOSITORY = 'TAXONOMY_REPOSITORY';

/**
 * Persistence port for the taxonomy.
 *
 * Deletion is intentionally not part of the port: terms are archived so that
 * historical orders keep a valid snapshot (`specs/05-api-spec.md` §Taxonomy).
 */
export interface TaxonomyRepository {
  listByType(type: TaxonomyType, options?: { activeOnly?: boolean }): Promise<TaxonomyTerm[]>;

  /** Bounded, filtered page for the admin listing (`page`/`pageSize`). */
  list(query: TaxonomyTermQuery): Promise<TaxonomyTermPage>;

  findById(id: string): Promise<TaxonomyTerm | null>;

  findByCode(type: TaxonomyType, code: string): Promise<TaxonomyTerm | null>;

  create(input: CreateTaxonomyTermInput): Promise<TaxonomyTerm>;

  update(id: string, input: UpdateTaxonomyTermInput): Promise<TaxonomyTerm>;
}
