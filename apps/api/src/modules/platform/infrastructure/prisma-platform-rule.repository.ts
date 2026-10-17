import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  CreatePlatformRuleInput,
  PlatformRule,
  PlatformRuleStatus,
} from '../domain/platform-rule.model';
import type { PlatformRuleRepository } from '../domain/platform-rule.repository';

/** Prisma adapter for {@link PlatformRuleRepository}. */
@Injectable()
export class PrismaPlatformRuleRepository implements PlatformRuleRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreatePlatformRuleInput): Promise<PlatformRule> {
    const row = await this.prisma.platformRule.create({
      data: {
        ruleType: input.ruleType,
        version: input.version,
        contentRef: input.contentRef,
        effectiveAt: input.effectiveAt ?? null,
        // A rule is written as a draft: publishing is its own audited command.
        status: 'DRAFT',
      },
    });
    return mapRule(row);
  }

  async findById(id: string): Promise<PlatformRule | null> {
    const row = await this.prisma.platformRule.findUnique({ where: { id } });
    return row ? mapRule(row) : null;
  }

  async list(ruleType?: string | null): Promise<PlatformRule[]> {
    const rows = await this.prisma.platformRule.findMany({
      where: ruleType ? { ruleType } : {},
      // Newest first: version strings are ordered lexicographically, which is
      // why `createdAt` is the tiebreaker an operator actually reads.
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    });
    return rows.map(mapRule);
  }

  async findPublished(ruleType: string): Promise<PlatformRule | null> {
    const row = await this.prisma.platformRule.findFirst({
      where: { ruleType, status: 'PUBLISHED' },
    });
    return row ? mapRule(row) : null;
  }

  async setStatus(
    id: string,
    status: PlatformRuleStatus,
    publishedAt?: Date | null,
  ): Promise<PlatformRule> {
    const row = await this.prisma.platformRule.update({
      where: { id },
      data: {
        status,
        ...(publishedAt === undefined ? {} : { publishedAt }),
      },
    });
    return mapRule(row);
  }
}

function mapRule(row: {
  id: string;
  ruleType: string;
  version: string;
  status: PlatformRuleStatus;
  contentRef: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}): PlatformRule {
  return {
    id: row.id,
    ruleType: row.ruleType,
    version: row.version,
    status: row.status,
    contentRef: row.contentRef,
    effectiveAt: row.effectiveAt,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}
