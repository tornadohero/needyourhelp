import type {
  CreatePlatformRuleInput,
  PlatformRule,
  PlatformRuleStatus,
} from './platform-rule.model';

/** Dependency-injection token for {@link PlatformRuleRepository}. */
export const PLATFORM_RULE_REPOSITORY = 'PLATFORM_RULE_REPOSITORY';

export interface PlatformRuleRepository {
  create(input: CreatePlatformRuleInput): Promise<PlatformRule>;

  findById(id: string): Promise<PlatformRule | null>;

  /** `GET /admin/platform-rules`: newest first, optionally by type. */
  list(ruleType?: string | null): Promise<PlatformRule[]>;

  findPublished(ruleType: string): Promise<PlatformRule | null>;

  /** Publishing one version archives the one it replaces. */
  setStatus(
    id: string,
    status: PlatformRuleStatus,
    publishedAt?: Date | null,
  ): Promise<PlatformRule>;
}
