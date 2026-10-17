import type { PlatformRuleStatusName } from '@mentor/api-contracts';

/**
 * Domain view of `platform_rules` (`specs/04-database-spec.md`,
 * `specs/10-privacy-and-minors.md` §Platform rules).
 *
 * Commercial policy must be public, clear and versioned rather than hard-coded:
 * a rule is published as a version, and publishing archives the version it
 * replaces — the trail of what the platform told its users is never rewritten.
 */
export type PlatformRuleStatus = PlatformRuleStatusName;

export interface PlatformRule {
  id: string;
  ruleType: string;
  version: string;
  status: PlatformRuleStatus;
  /** Where the published text lives; the platform stores the reference, not a copy. */
  contentRef: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface CreatePlatformRuleInput {
  ruleType: string;
  version: string;
  contentRef: string;
  effectiveAt?: Date | null;
}
