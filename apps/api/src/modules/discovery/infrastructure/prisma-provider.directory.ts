import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { isUuid } from '../../catalog/domain/taxonomy-policy';
import { FEATURE_FLAG_REPOSITORY } from '../../platform/domain/feature-flag.repository';
import type { FeatureFlagRepository } from '../../platform/domain/feature-flag.repository';
import { FEATURE_FLAGS } from '../../platform/infrastructure/prisma-feature-flag.repository';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  mapProviderCapabilityRow,
  mapProviderProfileRow,
} from '../../provider/infrastructure/provider-row.mapper';
import {
  SERVICE_TERMS_INCLUDE,
  mapServiceRow,
} from '../../services/infrastructure/service-row.mapper';
import type { ProviderDirectory } from '../domain/provider-directory';
import type {
  ProviderDetail,
  ProviderSearchPage,
  ProviderSearchQuery,
  ProviderSort,
} from '../domain/provider-search.model';

/**
 * Prisma read model for discovery (`specs/05-api-spec.md` §Provider).
 *
 * The discovery gate lives here, in one `where`: `searchable` (computed by the
 * provider, verification and service gates of T005/T006/T009), the approval
 * status and an active account. Nothing else in the discovery context can widen
 * it, so a listing can never contain a provider the platform decided to hide
 * (`specs/01-business-rules.md` §Provider approval).
 */
@Injectable()
export class PrismaProviderDirectory implements ProviderDirectory {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // The career marketplace is feature-flagged: the gate lives here, with the
    // rest of the discoverability rules, so ordering (T013) and reviews (T017)
    // inherit it and cannot bypass it with a known id (T021).
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
  ) {}

  async search(query: ProviderSearchQuery): Promise<ProviderSearchPage> {
    if (query.domain === 'CAREER' && !(await this.isCareerOpen())) {
      return { hits: [], total: 0 };
    }

    const where = buildWhere(query);

    const [total, rows] = await Promise.all([
      this.prisma.providerProfile.count({ where }),
      this.prisma.providerProfile.findMany({
        where,
        include: { capabilities: { orderBy: { createdAt: 'asc' } } },
        // Always deterministic: `id` breaks ties so paging never repeats a row.
        orderBy: orderFor(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    // One extra query for the whole page, never one per provider.
    const prices = await this.minPrices(rows.map((row) => row.id));

    return {
      hits: rows.map((row) => ({
        provider: mapProviderProfileRow(row),
        capabilities: row.capabilities.map(mapProviderCapabilityRow),
        minPriceMinor: prices.get(row.id) ?? null,
      })),
      total,
    };
  }

  async findDiscoverable(providerId: string): Promise<ProviderDetail | null> {
    if (!isUuid(providerId)) {
      return null;
    }

    const row = await this.prisma.providerProfile.findFirst({
      where: { ...DISCOVERABLE, id: providerId },
      include: {
        capabilities: { orderBy: { createdAt: 'asc' } },
        // Only published services are public (`specs/06` §Service publication).
        services: {
          where: { status: 'PUBLISHED' },
          include: SERVICE_TERMS_INCLUDE,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!row) {
      return null;
    }

    // A career provider is invisible while the marketplace is switched off.
    if (row.providerType === 'CAREER' && !(await this.isCareerOpen())) {
      return null;
    }

    return {
      provider: mapProviderProfileRow(row),
      capabilities: row.capabilities.map(mapProviderCapabilityRow),
      services: row.services.map(mapServiceRow),
    };
  }

  private async isCareerOpen(): Promise<boolean> {
    return this.flags.isEnabled(FEATURE_FLAGS.careerMarketplace);
  }

  private async minPrices(providerIds: string[]): Promise<Map<string, number>> {
    if (providerIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.service.groupBy({
      by: ['providerId'],
      where: { providerId: { in: providerIds }, status: 'PUBLISHED' },
      _min: { priceMinor: true },
    });

    return new Map(
      rows.flatMap((row) =>
        row._min.priceMinor === null ? [] : [[row.providerId, row._min.priceMinor]],
      ),
    );
  }
}

/**
 * The gate itself.
 *
 * `searchable` is server-owned and recomputed from the readiness gates; the
 * approval status and the account state are re-checked here so a stale flag can
 * never expose a provider on its own.
 */
const DISCOVERABLE: Prisma.ProviderProfileWhereInput = {
  searchable: true,
  approvalStatus: 'APPROVED',
  user: { status: 'ACTIVE', deletedAt: null },
};

function buildWhere(query: ProviderSearchQuery): Prisma.ProviderProfileWhereInput {
  const conditions: Prisma.ProviderProfileWhereInput[] = [];

  if (query.cityCode) {
    conditions.push({ cityCode: query.cityCode });
  }
  if (query.capabilityType) {
    conditions.push({ capabilities: { some: { capabilityType: query.capabilityType } } });
  }
  if (query.verifiedOnly) {
    // `FULL` = identity and education approved (T006); it is the only level the
    // platform presents as "verified".
    conditions.push({ capabilities: { some: { verificationLevel: 'FULL' } } });
  }

  // Tag filters are separate conditions on the same service: a service must
  // carry the subject *and* the grade, but not on the same tag row.
  const serviceConditions: Prisma.ServiceWhereInput[] = [];
  if (query.subjectCode) {
    serviceConditions.push({
      terms: { some: { term: { type: 'SUBJECT', code: query.subjectCode } } },
    });
  }
  if (query.gradeCode) {
    serviceConditions.push({
      terms: { some: { term: { type: 'GRADE', code: query.gradeCode } } },
    });
  }

  const price: Prisma.IntFilter = {};
  if (query.minPriceMinor !== null) {
    price.gte = query.minPriceMinor;
  }
  if (query.maxPriceMinor !== null) {
    price.lte = query.maxPriceMinor;
  }

  const services: Prisma.ServiceWhereInput = { status: 'PUBLISHED' };
  if (query.deliveryMode) {
    services.deliveryMode = query.deliveryMode;
  }
  if (query.minPriceMinor !== null || query.maxPriceMinor !== null) {
    services.priceMinor = price;
  }
  if (serviceConditions.length > 0) {
    services.AND = serviceConditions;
  }

  const hasServiceFilter =
    query.subjectCode !== null ||
    query.gradeCode !== null ||
    query.deliveryMode !== null ||
    query.minPriceMinor !== null ||
    query.maxPriceMinor !== null;
  if (hasServiceFilter) {
    conditions.push({ services: { some: services } });
  }

  return {
    ...DISCOVERABLE,
    providerType: query.domain,
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}

/**
 * V1 ranking (`specs/01-business-rules.md` §Ranking).
 *
 * The hard filters above already enforce "approved", "subject", "grade",
 * "city/remote" and "price range fit", so what is left to order by is the
 * retrieval signal: rating count, rating, completed orders, recency. It is an
 * ordering, never a quality score. Service availability (T011) is not part of it
 * yet.
 */
function orderFor(sort: ProviderSort): Prisma.ProviderProfileOrderByWithRelationInput[] {
  switch (sort) {
    // "评分" means the score: a 4.9 must come before a 4.6 even when the 4.6 has
    // more reviews. The review count only breaks a tie, so two 5.0 mentors are
    // ordered by how much evidence stands behind the score.
    case 'rating':
      return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    default:
      return [
        { ratingCount: 'desc' },
        { ratingAvg: 'desc' },
        { completedOrderCount: 'desc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ];
  }
}
