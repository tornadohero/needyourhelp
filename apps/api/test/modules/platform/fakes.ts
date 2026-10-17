import type {
  CreatePlatformRuleInput,
  PlatformRule,
  PlatformRuleStatus,
} from '../../../src/modules/platform/domain/platform-rule.model';
import type { PlatformRuleRepository } from '../../../src/modules/platform/domain/platform-rule.repository';

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-b000-${String(sequence).padStart(12, '0')}`;
}

/** In-memory {@link PlatformRuleRepository}. */
export class FakePlatformRuleRepository implements PlatformRuleRepository {
  readonly rules = new Map<string, PlatformRule>();

  async create(input: CreatePlatformRuleInput): Promise<PlatformRule> {
    const rule: PlatformRule = {
      id: nextId(),
      ruleType: input.ruleType,
      version: input.version,
      status: 'DRAFT',
      contentRef: input.contentRef,
      effectiveAt: input.effectiveAt ?? null,
      publishedAt: null,
      createdAt: new Date(),
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async findById(id: string): Promise<PlatformRule | null> {
    return this.rules.get(id) ?? null;
  }

  async list(ruleType?: string | null): Promise<PlatformRule[]> {
    return [...this.rules.values()]
      .filter((rule) => !ruleType || rule.ruleType === ruleType)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async findPublished(ruleType: string): Promise<PlatformRule | null> {
    return (
      [...this.rules.values()].find(
        (rule) => rule.ruleType === ruleType && rule.status === 'PUBLISHED',
      ) ?? null
    );
  }

  async setStatus(
    id: string,
    status: PlatformRuleStatus,
    publishedAt?: Date | null,
  ): Promise<PlatformRule> {
    const current = this.rules.get(id);
    if (!current) {
      throw new Error(`unknown rule ${id}`);
    }
    const updated: PlatformRule = {
      ...current,
      status,
      publishedAt: publishedAt === undefined ? current.publishedAt : publishedAt,
    };
    this.rules.set(id, updated);
    return updated;
  }
}
