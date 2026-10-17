/**
 * Seed definitions and the seed routine for T002 (Database foundation).
 *
 * Creates:
 * - feature flags (`specs/03-architecture-spec.md` §Feature flags)
 * - admin / operations / test users with their roles (`specs/01-business-rules.md`)
 * - taxonomy terms: SUBJECT / GRADE / SKILL / CITY (`specs/04-database-spec.md`)
 *
 * The seed is idempotent: every write is an upsert on a natural key, so it is
 * safe to run repeatedly against a fresh or an existing database.
 *
 * No secrets, no PII and no child data are seeded: `users` has no email column,
 * so seeded accounts are identified by a deterministic WeChat openid hash.
 *
 * Kept free of side effects so `prisma db seed` and the repository integration
 * tests can run exactly the same code path.
 */
import { createHash } from 'node:crypto';

import type {
  ConsentType,
  FeatureFlag,
  Prisma,
  PrismaClient,
  Role,
  TaxonomyTerm,
  TaxonomyType,
  User,
  UserRole,
} from '@prisma/client';

/** Deterministic, non-reversible identifier for a seeded account. */
export function seedOpenidHash(seedKey: string): string {
  return createHash('sha256').update(`mentor-platform:seed:${seedKey}`).digest('hex');
}

export interface SeedUserSpec {
  seedKey: string;
  displayName: string;
  roles: Role[];
}

/**
 * Admin and test accounts. `USER` is the base account role
 * (`specs/01-business-rules.md` §Account and roles).
 */
export const SEED_USERS: readonly SeedUserSpec[] = [
  { seedKey: 'admin', displayName: 'Platform Admin', roles: ['USER', 'ADMIN'] },
  { seedKey: 'ops', displayName: 'Platform Ops', roles: ['USER', 'OPS'] },
  { seedKey: 'finance', displayName: 'Platform Finance', roles: ['USER', 'FINANCE'] },
  { seedKey: 'moderator', displayName: 'Platform Moderator', roles: ['USER', 'MODERATOR'] },
  { seedKey: 'parent', displayName: 'Test Parent', roles: ['USER', 'PARENT'] },
  { seedKey: 'student', displayName: 'Test Student', roles: ['USER', 'STUDENT'] },
  { seedKey: 'provider', displayName: 'Test Provider', roles: ['USER', 'PROVIDER'] },
];

/**
 * Feature flags. All flags default to disabled: V1 tutoring is the default
 * marketplace and career is feature-flagged (`specs/03-architecture-spec.md`,
 * `AGENTS.md` §7).
 */
export const SEED_FEATURE_FLAGS: readonly {
  key: string;
  enabled: boolean;
  config: Prisma.InputJsonValue;
}[] = [
  { key: 'career_marketplace_enabled', enabled: false, config: {} },
  { key: 'teacher_provider_enabled', enabled: false, config: {} },
  { key: 'wechat_payment_enabled', enabled: false, config: {} },
  { key: 'im_enabled', enabled: false, config: {} },
  { key: 'ai_matching_enabled', enabled: false, config: {} },
  { key: 'settlement_enabled', enabled: false, config: {} },
];

export interface TaxonomySeedTerm {
  code: string;
  name: string;
}

/**
 * V1 taxonomy. Terms are archived instead of deleted, so the seed never removes
 * anything (`specs/05-api-spec.md` §Taxonomy notes).
 */
export const SEED_TAXONOMY: Readonly<Record<TaxonomyType, readonly TaxonomySeedTerm[]>> = {
  SUBJECT: [
    { code: 'CHINESE', name: '语文' },
    { code: 'MATH', name: '数学' },
    { code: 'ENGLISH', name: '英语' },
    { code: 'PHYSICS', name: '物理' },
    { code: 'CHEMISTRY', name: '化学' },
    { code: 'BIOLOGY', name: '生物' },
  ],
  GRADE: [
    { code: 'PRIMARY_1', name: '小学一年级' },
    { code: 'PRIMARY_2', name: '小学二年级' },
    { code: 'PRIMARY_3', name: '小学三年级' },
    { code: 'PRIMARY_4', name: '小学四年级' },
    { code: 'PRIMARY_5', name: '小学五年级' },
    { code: 'PRIMARY_6', name: '小学六年级' },
    { code: 'JUNIOR_1', name: '初中一年级' },
    { code: 'JUNIOR_2', name: '初中二年级' },
    { code: 'JUNIOR_3', name: '初中三年级' },
    { code: 'SENIOR_1', name: '高中一年级' },
    { code: 'SENIOR_2', name: '高中二年级' },
    { code: 'SENIOR_3', name: '高中三年级' },
  ],
  SKILL: [
    { code: 'HOMEWORK_SUPPORT', name: '作业辅导' },
    { code: 'EXAM_PREP', name: '考试冲刺' },
    { code: 'STUDY_PLANNING', name: '学习规划' },
    { code: 'SPEAKING_PRACTICE', name: '口语练习' },
    { code: 'COMPETITION_COACHING', name: '竞赛辅导' },
  ],
  CITY: [
    { code: 'BEIJING', name: '北京' },
    { code: 'SHANGHAI', name: '上海' },
    { code: 'GUANGZHOU', name: '广州' },
    { code: 'SHENZHEN', name: '深圳' },
    { code: 'HANGZHOU', name: '杭州' },
  ],
};

/** Consent types that exist in the platform (`specs/10-privacy-and-minors.md`). */
export const CONSENT_TYPES: readonly ConsentType[] = [
  'TERMS',
  'PRIVACY',
  'SENSITIVE_DATA',
  'MINOR_GUARDIAN',
  'MARKETING',
  'IM_POLICY',
];

export interface SeedResult {
  users: User[];
  userRoles: UserRole[];
  featureFlags: FeatureFlag[];
  taxonomyTerms: TaxonomyTerm[];
}

/** Run the seed against an existing PrismaClient. */
export async function seedDatabase(client: PrismaClient): Promise<SeedResult> {
  const users: User[] = [];
  const userRoles: UserRole[] = [];

  for (const spec of SEED_USERS) {
    const openidHash = seedOpenidHash(spec.seedKey);
    const user = await client.user.upsert({
      where: { wechatOpenidHash: openidHash },
      create: {
        wechatOpenidHash: openidHash,
        displayName: spec.displayName,
        status: 'ACTIVE',
      },
      update: { displayName: spec.displayName, deletedAt: null },
    });
    users.push(user);

    for (const role of spec.roles) {
      const userRole = await client.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        create: { userId: user.id, role },
        update: {},
      });
      userRoles.push(userRole);
    }
  }

  const featureFlags: FeatureFlag[] = [];
  for (const flag of SEED_FEATURE_FLAGS) {
    featureFlags.push(
      await client.featureFlag.upsert({
        where: { key: flag.key },
        create: { key: flag.key, enabled: flag.enabled, configJson: flag.config },
        update: { configJson: flag.config },
      }),
    );
  }

  const taxonomyTerms: TaxonomyTerm[] = [];
  for (const type of Object.keys(SEED_TAXONOMY) as TaxonomyType[]) {
    for (const term of SEED_TAXONOMY[type]) {
      taxonomyTerms.push(
        await client.taxonomyTerm.upsert({
          where: { type_code: { type, code: term.code } },
          create: { type, code: term.code, name: term.name, active: true },
          update: { name: term.name },
        }),
      );
    }
  }

  return { users, userRoles, featureFlags, taxonomyTerms };
}
