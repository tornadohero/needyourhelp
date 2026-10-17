import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { describe } from 'vitest';

import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service';
import { PrismaService as PrismaServiceClass } from '../../../src/infrastructure/prisma/prisma.service';

/**
 * Integration tests run against a disposable PostgreSQL database.
 *
 * The database is reset from the committed Prisma migrations by
 * `global-setup.ts`. When `DATABASE_TEST_URL` is not configured the suite is
 * skipped instead of failing, so a machine without PostgreSQL can still run the
 * unit suites.
 */
export const TEST_DATABASE_URL = process.env.DATABASE_TEST_URL ?? '';

export const databaseIntegrationEnabled = TEST_DATABASE_URL.length > 0;

/**
 * `describe` for database integration tests: skipped when no test database is
 * configured, so machines without PostgreSQL can still run the unit suites.
 */
export function describeWithDatabase(name: string, factory: () => void): void {
  (databaseIntegrationEnabled ? describe : describe.skip)(name, factory);
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
}

/**
 * `PrismaService` bound to the test database.
 *
 * Repository adapters depend on `PrismaService`, so integration tests use the
 * real NestJS-managed client instead of a bare `PrismaClient`.
 */
export function createTestPrismaService(): PrismaService {
  return new PrismaServiceClass({ datasources: { db: { url: TEST_DATABASE_URL } } });
}

/** Namespaced fixture value so parallel/dirty databases never collide. */
export function fixtureKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
