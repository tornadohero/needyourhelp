import { afterAll, beforeAll, expect, it } from 'vitest';

import { createTestPrisma, describeWithDatabase } from './helpers/test-database';

/**
 * Verifies that the committed migration produces exactly the V1 schema of
 * `specs/04-database-spec.md`: tables, deferred tables, column types, money
 * columns, privacy constraints and the required index set.
 */

const V1_TABLES = [
  'audit_logs',
  'availability_slots',
  'blocks',
  'child_profiles',
  'consents',
  'conversation_members',
  'conversations',
  'feature_flags',
  'message_refs',
  'moderation_cases',
  'notifications',
  'orders',
  'parent_profiles',
  'payments',
  'platform_rules',
  'provider_capabilities',
  'provider_profiles',
  'refunds',
  'reports',
  'reviews',
  'service_terms',
  'services',
  'sessions',
  'taxonomy_terms',
  'user_roles',
  'users',
  'verification_cases',
  'verification_documents',
];

/** `specs/04-database-spec.md` §Deferred tables — must NOT exist in V1. */
const DEFERRED_TABLES = ['career_goals', 'mentor_capabilities', 'settlement_items', 'settlements'];

/** `specs/04-database-spec.md` §Indexes — required index names. */
const REQUIRED_INDEXES = [
  'sessions_user_id_revoked_at_idx',
  'sessions_expires_at_idx',
  'provider_profiles_searchable_approval_status_city_code_idx',
  'provider_capabilities_provider_id_capability_type_status_idx',
  'services_provider_id_status_idx',
  'service_terms_term_id_service_id_idx',
  'orders_buyer_user_id_created_at_idx',
  'orders_provider_id_created_at_idx',
  'orders_status_scheduled_start_idx',
  'payments_order_id_idx',
  'reviews_reviewee_user_id_created_at_idx',
  'reports_status_created_at_idx',
  'moderation_cases_status_created_at_idx',
  'moderation_cases_target_type_target_id_idx',
  'moderation_cases_assigned_moderator_id_status_idx',
  'notifications_user_id_created_at_idx',
  'notifications_user_id_status_read_at_idx',
  'notifications_dedupe_key_key',
  'audit_logs_resource_type_resource_id_created_at_idx',
];

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

interface IndexRow {
  indexname: string;
}

describeWithDatabase('database migration (V1 schema)', () => {
  const prisma = createTestPrisma();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('fresh migration creates every V1 table', async () => {
    const rows = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tables = new Set(rows.map((row) => row.table_name));

    for (const table of V1_TABLES) {
      expect(tables.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it('does not create the deferred V1.1 tables', async () => {
    const rows = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tables = new Set(rows.map((row) => row.table_name));

    for (const table of DEFERRED_TABLES) {
      expect(tables.has(table), `deferred table ${table} must not exist in V1`).toBe(false);
    }
  });

  it('stores money as integer minor units', async () => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name LIKE '%_minor'
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe('integer');
    }
  });

  it('keeps child profiles minimal', async () => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'child_profiles'
    `;
    const columns = new Set(rows.map((row) => row.column_name));

    expect([...columns].sort()).toEqual(
      [
        'birth_year',
        'created_at',
        'data_processing_consent_status',
        'deleted_at',
        'grade_code',
        'guardian_user_id',
        'id',
        'learning_goals',
        'nickname',
        'school_name',
        'updated_at',
      ].sort(),
    );
  });

  it('creates the required indexes', async () => {
    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;
    const indexes = new Set(rows.map((row) => row.indexname));

    for (const index of REQUIRED_INDEXES) {
      expect(indexes.has(index), `missing index ${index}`).toBe(true);
    }
  });

  it('stores the teacher compliance restriction as jsonb', async () => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'provider_capabilities'
        AND column_name = 'restriction_json'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.data_type).toBe('jsonb');
  });

  it('refuses overlapping availability slots at the database level', async () => {
    const rows = await prisma.$queryRaw<{ conname: string; contype: string }[]>`
      SELECT conname, contype::text AS contype
      FROM pg_constraint
      WHERE conname = 'availability_slots_no_overlap'
    `;

    // T011: the constraint is an exclusion (`x`), not a plain unique check, so
    // it also covers partial overlaps rather than identical windows only.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contype).toBe('x');
  });

  it('persists order snapshots as jsonb', async () => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('price_snapshot', 'policy_snapshot')
    `;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.data_type).toBe('jsonb');
    }
  });
});
