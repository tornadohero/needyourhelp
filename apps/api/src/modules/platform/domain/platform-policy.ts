import { platformInvalidRequest, platformNotFound } from './platform.errors';

/**
 * Platform configuration rules (`specs/10-privacy-and-minors.md` §Platform
 * rules, `specs/12-admin-spec.md` §Audit).
 *
 * A rule is versioned and moved by commands, never edited in place: `DRAFT` is
 * written, `PUBLISHED` is the version users are told about, and publishing a new
 * version archives the old one so the trail survives.
 */

export const MAX_RULE_TYPE_LENGTH = 64;
export const MAX_RULE_VERSION_LENGTH = 32;
export const MAX_CONTENT_REF_LENGTH = 512;

export const PLATFORM_RULE_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function assertRuleType(value: string): string {
  const ruleType = value.trim();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(ruleType)) {
    throw platformInvalidRequest(
      'A rule type is lower-case, starts with a letter and uses letters, digits or underscores.',
    );
  }
  if (ruleType.length > MAX_RULE_TYPE_LENGTH) {
    throw platformInvalidRequest(`A rule type must be at most ${MAX_RULE_TYPE_LENGTH} characters.`);
  }
  return ruleType;
}

export function assertVersion(value: string): string {
  const version = value.trim();
  if (version.length === 0 || version.length > MAX_RULE_VERSION_LENGTH) {
    throw platformInvalidRequest(
      `A rule version must be between 1 and ${MAX_RULE_VERSION_LENGTH} characters.`,
    );
  }
  return version;
}

/** The text lives behind a reference; the platform never stores a second copy. */
export function assertContentRef(value: string): string {
  const contentRef = value.trim();
  if (contentRef.length === 0 || contentRef.length > MAX_CONTENT_REF_LENGTH) {
    throw platformInvalidRequest(
      `A content reference must be between 1 and ${MAX_CONTENT_REF_LENGTH} characters.`,
    );
  }
  return contentRef;
}

export function assertRuleTransition(from: string, to: string): void {
  if (!PLATFORM_RULE_TRANSITIONS[from]?.includes(to)) {
    throw platformInvalidRequest(`A rule in status ${from} cannot move to ${to}.`);
  }
}

export function assertKnownRule(rule: unknown): void {
  if (!rule) {
    throw platformNotFound('Platform rule not found.');
  }
}
