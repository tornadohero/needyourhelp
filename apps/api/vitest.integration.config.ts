import fs from 'node:fs';
import path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Database integration tests: they run against the disposable database in
// `DATABASE_TEST_URL`, which `test/integration/global-setup.ts` rebuilds from
// the committed migrations before the suite starts.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Minimal `.env` reader.
 *
 * Vitest does not expose repository `.env` files to `globalSetup`, so the
 * integration config reads them itself and forwards the values into both the
 * main process and the workers.
 */
function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match?.[1]) {
      continue;
    }
    values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const fileEnv = readEnvFile(path.join(REPO_ROOT, '.env'));
const testDatabaseUrl = process.env.DATABASE_TEST_URL ?? fileEnv.DATABASE_TEST_URL ?? '';
process.env.DATABASE_TEST_URL = testDatabaseUrl;

// Forward the repository `.env` (database URLs, auth secrets) into the workers.
const workerEnv: Record<string, string> = { ...fileEnv, DATABASE_URL: testDatabaseUrl };
if (testDatabaseUrl) {
  workerEnv.DATABASE_TEST_URL = testDatabaseUrl;
}

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Database-backed suites: repository/integration tests and the end-to-end
    // journeys of `specs/14-test-strategy.md`.
    include: ['test/integration/**/*.spec.ts', 'test/e2e/**/*.spec.ts'],
    globalSetup: ['./test/integration/global-setup.ts'],
    env: workerEnv,
    // The suite shares one database; files must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
