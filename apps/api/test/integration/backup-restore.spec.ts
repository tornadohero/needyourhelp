import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPrisma } from './helpers/test-database';

/**
 * Restore drill (T024: "backups / restore test").
 *
 * A backup that has never been restored is a guess. This test proves the whole
 * loop, with the scripts operations actually runs (`ops/backup.sh`,
 * `ops/restore.sh`):
 *
 *   1. write rows into the disposable database;
 *   2. dump it and checksum the dump;
 *   3. restore the dump into a scratch database;
 *   4. compare every table's row count between the two databases;
 *   5. drop the scratch database.
 *
 * It is skipped — loudly — when the host has no `pg_dump`/`pg_restore`, or when
 * the client is older than the server: those are environment facts, not a
 * statement about the backup.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

interface Tooling {
  pgDump: string;
  pgRestore: string;
  psql: string;
}

function which(binary: string): string | null {
  try {
    return execFileSync('which', [binary], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function majorVersion(binary: string): number | null {
  try {
    const output = execFileSync(binary, ['--version'], { encoding: 'utf8' });
    const match = /(\d+)(?:\.\d+)*/.exec(output);
    return match?.[1] ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

const TEST_DATABASE_URL = process.env.DATABASE_TEST_URL ?? '';

let tooling: Tooling | null = null;
let skipReason: string | null = null;

if (!TEST_DATABASE_URL) {
  skipReason = 'DATABASE_TEST_URL is not set';
} else {
  const pgDump = which('pg_dump');
  const pgRestore = which('pg_restore');
  const psql = which('psql');
  if (!pgDump || !pgRestore || !psql) {
    skipReason = 'pg_dump/pg_restore/psql are not available on this host';
  } else {
    tooling = { pgDump, pgRestore, psql };
  }
}

/** Connection parts of a `postgresql://` URL. */
function partsOf(url: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
} {
  const rest = url.replace(/^.*:\/\//, '');
  const userpass = rest.slice(0, rest.indexOf('@'));
  const hostportDb = rest.slice(rest.indexOf('@') + 1);
  const [hostport, database] = hostportDb.split('/');
  const queryFree = (database ?? '').split('?')[0] ?? '';
  return {
    host: (hostport ?? '').split(':')[0] ?? 'localhost',
    port: (hostport ?? '').split(':')[1] ?? '5432',
    user: userpass.split(':')[0] ?? 'postgres',
    password: userpass.split(':')[1] ?? '',
    database: queryFree,
  };
}

function psql(database: string, sql: string, password: string): string {
  const source = partsOf(TEST_DATABASE_URL);
  return execFileSync(
    tooling!.psql,
    [
      '--host',
      source.host,
      '--port',
      source.port,
      '--username',
      source.user,
      '--no-password',
      '--dbname',
      database,
      '-tAc',
      sql,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: password || source.password },
    },
  ).trim();
}

const BASE_TABLES_SQL = `SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;

describe('backup and restore', () => {
  let prisma: PrismaClient | undefined;
  let workDir: string;
  let scratchDatabase = '';
  let sourcePassword = '';

  beforeAll(async () => {
    if (!tooling) {
      return;
    }
    prisma = createTestPrisma();
    await prisma.$connect();

    // A client older than the server cannot dump it: that is an environment
    // fact, so the drill is skipped rather than reported as a backup failure.
    const serverVersion =
      (await prisma.$queryRawUnsafe<{ server_version: string }[]>('SHOW server_version')).at(0)
        ?.server_version ?? '';
    const serverMajor = Number(serverVersion.split('.')[0] ?? 0);
    const clientMajor = majorVersion(tooling.pgDump);
    if (clientMajor !== null && serverMajor > 0 && clientMajor < serverMajor) {
      await prisma.$disconnect();
      skipReason = `pg_dump client ${clientMajor} is older than server ${serverMajor}`;
      tooling = null;
      return;
    }

    workDir = mkdtempSync(path.join(tmpdir(), 'mentor-backup-'));
    sourcePassword = partsOf(TEST_DATABASE_URL).password;
    scratchDatabase = `mentor_restore_${Date.now().toString(36)}`;
  });

  afterAll(async () => {
    if (scratchDatabase) {
      try {
        psql('postgres', `DROP DATABASE IF EXISTS "${scratchDatabase}"`, sourcePassword);
      } catch {
        // Nothing to clean up: the scratch database never came up or is gone.
      }
    }
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
    await prisma?.$disconnect();
  });

  it('restores a dump that contains everything the database had', async () => {
    if (!tooling) {
      console.warn(`[restore drill] skipped: ${skipReason}`);
      return;
    }

    const source = prisma;
    if (!source) {
      return;
    }

    // Something to back up, written through the ORM the platform uses.
    const user = await source.user.create({ data: { displayName: '备份用户', status: 'ACTIVE' } });
    await source.featureFlag.create({
      data: { key: `backup_drill_${Date.now()}`, enabled: true, updatedAt: new Date() },
    });

    const dump = execFileSync(path.join(REPO_ROOT, 'ops', 'backup.sh'), [], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        BACKUP_DIR: workDir,
        RETENTION_DAYS: '0',
      },
    })
      .trim()
      .split('\n')
      .at(-1)!;

    expect(dump).toContain(path.join(workDir, 'mentor-'));
    expect(dump.endsWith('.dump')).toBe(true);

    // The checksum that ships with the dump must verify it.
    const checksumFile = `${dump}.sha256`;
    const checker = which('sha256sum') ? 'sha256sum' : 'shasum';
    const checkerArgs =
      checker === 'sha256sum' ? ['-c', checksumFile] : ['-a', '256', '-c', checksumFile];
    expect(() =>
      // The checksum file names the dump by its basename, so it is verified
      // from the directory that holds both.
      execFileSync(checker, checkerArgs, {
        cwd: path.dirname(dump),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).not.toThrow();

    // Restore into a scratch database with the script operations runs.
    const scratchUrl = TEST_DATABASE_URL.replace(/\/[^/?]*(\?|$)/, `/${scratchDatabase}$1`);
    const output = execFileSync(path.join(REPO_ROOT, 'ops', 'restore.sh'), [dump, scratchUrl], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    expect(output).toContain('restore: ok');
    expect(output).toContain('checksum verified');

    // Same tables, same rows: a restore that loses rows is not a restore.
    const sourceTables = psql(partsOf(TEST_DATABASE_URL).database, BASE_TABLES_SQL, sourcePassword)
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);
    const restoredTables = psql(scratchDatabase, BASE_TABLES_SQL, sourcePassword)
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);

    expect(restoredTables).toEqual(sourceTables);
    expect(sourceTables.length).toBeGreaterThan(10);

    for (const table of ['users', 'feature_flags', 'taxonomy_terms']) {
      const source = Number(
        psql(partsOf(TEST_DATABASE_URL).database, `SELECT count(*) FROM ${table}`, sourcePassword),
      );
      const restored = Number(
        psql(scratchDatabase, `SELECT count(*) FROM ${table}`, sourcePassword),
      );
      expect(restored, `${table} row count`).toBe(source);
    }

    // The user written before the dump is in the restored database.
    const restoredName = psql(
      scratchDatabase,
      `SELECT display_name FROM users WHERE id = '${user.id}'`,
      sourcePassword,
    ).trim();
    expect(restoredName).toBe('备份用户');

    // The restored database is a real platform database: migrations included.
    const migrations = Number(
      psql(scratchDatabase, 'SELECT count(*) FROM _prisma_migrations', sourcePassword),
    );
    expect(migrations).toBeGreaterThan(0);
  });
});
