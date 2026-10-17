import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { FeatureFlag, FeatureFlagRepository } from '../domain/feature-flag.repository';

/** Prisma adapter for {@link FeatureFlagRepository}. */
@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return flag?.enabled === true;
  }

  async list(): Promise<FeatureFlag[]> {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return rows.map(mapFlag);
  }

  async setEnabled(key: string, enabled: boolean): Promise<FeatureFlag> {
    // `updatedAt` is `@updatedAt`, so the change is timestamped by the database.
    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled },
      update: { enabled },
    });
    return mapFlag(row);
  }
}

/** Feature flag keys used by application code. */
export const FEATURE_FLAGS = {
  careerMarketplace: 'career_marketplace_enabled',
  /**
   * `specs/01-business-rules.md` §Review: a provider may review the customer
   * "only if enabled by policy". Off by default, like every unknown flag.
   */
  providerReviewCustomer: 'provider_review_customer_enabled',
} as const;

function mapFlag(row: {
  key: string;
  enabled: boolean;
  configJson: unknown;
  updatedAt: Date;
}): FeatureFlag {
  return {
    key: row.key,
    enabled: row.enabled,
    configJson:
      typeof row.configJson === 'object' && row.configJson !== null
        ? (row.configJson as Record<string, unknown>)
        : {},
    updatedAt: row.updatedAt,
  };
}
