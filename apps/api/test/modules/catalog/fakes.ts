import type {
  CreateTaxonomyTermInput,
  TaxonomyTerm,
  TaxonomyTermPage,
  TaxonomyTermQuery,
  TaxonomyType,
  UpdateTaxonomyTermInput,
} from '../../../src/modules/catalog/domain/taxonomy.model';
import type { TaxonomyRepository } from '../../../src/modules/catalog/domain/taxonomy.repository';

/**
 * In-memory {@link TaxonomyRepository}.
 *
 * Mirrors the database rules the service relies on: `(type, code)` is unique and
 * `update` fails on an unknown id.
 */
export class FakeTaxonomyRepository implements TaxonomyRepository {
  private readonly terms = new Map<string, TaxonomyTerm>();
  private sequence = 0;

  async listByType(
    type: TaxonomyType,
    options: { activeOnly?: boolean } = {},
  ): Promise<TaxonomyTerm[]> {
    return [...this.terms.values()]
      .filter((term) => term.type === type && (!options.activeOnly || term.active))
      .sort((left, right) => left.code.localeCompare(right.code));
  }

  async list(query: TaxonomyTermQuery): Promise<TaxonomyTermPage> {
    const matching = [...this.terms.values()]
      .filter(
        (term) =>
          (query.type === undefined || term.type === query.type) &&
          (query.active === undefined || term.active === query.active) &&
          (query.parentId === undefined || term.parentId === query.parentId),
      )
      .sort(
        (left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
      );

    return {
      items: matching.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: matching.length,
    };
  }

  async findById(id: string): Promise<TaxonomyTerm | null> {
    return this.terms.get(id) ?? null;
  }

  async findByCode(type: TaxonomyType, code: string): Promise<TaxonomyTerm | null> {
    return (
      [...this.terms.values()].find((term) => term.type === type && term.code === code) ?? null
    );
  }

  async create(input: CreateTaxonomyTermInput): Promise<TaxonomyTerm> {
    if (await this.findByCode(input.type, input.code)) {
      throw new Error(`duplicate taxonomy code ${input.type}/${input.code}`);
    }
    this.sequence += 1;
    const term: TaxonomyTerm = {
      // Shaped like a uuid: the service treats a non-uuid id as not found.
      id: `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
      type: input.type,
      code: input.code,
      name: input.name,
      parentId: input.parentId ?? null,
      active: true,
    };
    this.terms.set(term.id, term);
    return term;
  }

  async update(id: string, input: UpdateTaxonomyTermInput): Promise<TaxonomyTerm> {
    const current = this.terms.get(id);
    if (!current) {
      throw new Error(`unknown taxonomy term ${id}`);
    }
    const updated: TaxonomyTerm = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.active === undefined ? {} : { active: input.active }),
    };
    this.terms.set(id, updated);
    return updated;
  }

  /** Test seam: archive without going through the service. */
  async setActive(id: string, active: boolean): Promise<void> {
    const current = this.terms.get(id);
    if (current) {
      this.terms.set(id, { ...current, active });
    }
  }
}
