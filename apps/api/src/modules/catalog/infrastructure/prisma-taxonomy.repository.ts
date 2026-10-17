import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreateTaxonomyTermInput,
  TaxonomyTerm,
  TaxonomyTermPage,
  TaxonomyTermQuery,
  TaxonomyType,
  UpdateTaxonomyTermInput,
} from '../domain/taxonomy.model';
import type { TaxonomyRepository } from '../domain/taxonomy.repository';

/** Prisma adapter for {@link TaxonomyRepository}. */
@Injectable()
export class PrismaTaxonomyRepository implements TaxonomyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listByType(
    type: TaxonomyType,
    options: { activeOnly?: boolean } = {},
  ): Promise<TaxonomyTerm[]> {
    const rows = await this.prisma.taxonomyTerm.findMany({
      where: { type, ...(options.activeOnly ? { active: true } : {}) },
      orderBy: { code: 'asc' },
    });
    return rows.map(mapTerm);
  }

  async list(query: TaxonomyTermQuery): Promise<TaxonomyTermPage> {
    const where = {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.parentId === undefined ? {} : { parentId: query.parentId }),
    };

    // One round trip: the page and its total are read together, and the order is
    // total (`code`, then `id`) so paging never skips or repeats a row.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.taxonomyTerm.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taxonomyTerm.count({ where }),
    ]);

    return {
      items: rows.map(mapTerm),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async findById(id: string): Promise<TaxonomyTerm | null> {
    const row = await this.prisma.taxonomyTerm.findUnique({ where: { id } });
    return row ? mapTerm(row) : null;
  }

  async findByCode(type: TaxonomyType, code: string): Promise<TaxonomyTerm | null> {
    const row = await this.prisma.taxonomyTerm.findUnique({
      where: { type_code: { type, code } },
    });
    return row ? mapTerm(row) : null;
  }

  async create(input: CreateTaxonomyTermInput): Promise<TaxonomyTerm> {
    const row = await this.prisma.taxonomyTerm.create({
      data: {
        type: input.type,
        code: input.code,
        name: input.name,
        parentId: input.parentId ?? null,
      },
    });
    return mapTerm(row);
  }

  async update(id: string, input: UpdateTaxonomyTermInput): Promise<TaxonomyTerm> {
    const row = await this.prisma.taxonomyTerm.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });
    return mapTerm(row);
  }
}

type TaxonomyTermRow = {
  id: string;
  type: TaxonomyType;
  code: string;
  name: string;
  parentId: string | null;
  active: boolean;
};

function mapTerm(row: TaxonomyTermRow): TaxonomyTerm {
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    name: row.name,
    parentId: row.parentId,
    active: row.active,
  };
}
