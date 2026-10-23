import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const API_DIR = path.join(REPO_ROOT, 'apps', 'api');

/** The port the API listens on for the three-end run. */
const PORT = Number(process.env.E2E_API_PORT ?? 3_101);

let server: ReturnType<typeof spawn> | undefined;

/**
 * Boot the platform once, for real (T035).
 *
 * The three ends only prove something together if the server between them is the
 * same one `main.ts` boots: compiled, listening, reading the committed
 * migrations. So the suite builds the API, resets the disposable database from
 * the migrations and starts the process — and none of the three ends gets to
 * stub anything.
 */
/**
 * Read the repository's own `.env`, without overriding the environment.
 *
 * The suite needs one value from it — where the test database is. Nothing is
 * printed and nothing is written: a runner that sets the variable itself wins.
 */
function loadRepoEnv(): void {
  try {
    const raw = readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trim().startsWith('#')) {
        continue;
      }
      const key = match[1]!;
      if (process.env[key] === undefined) {
        process.env[key] = match[2]!.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No `.env`: a runner that configures the environment explicitly.
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  loadRepoEnv();

  // A dedicated database by default: the journey writes orders, payments and
  // refunds, and it should never be able to touch a developer's data.
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_TEST_URL ?? '';

  if (!databaseUrl) {
    console.warn('[three-end] no test database configured — the three-end suite is skipped.');
    return async () => undefined;
  }

  execFileSync('pnpm', ['--filter', '@mentor/api', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  execFileSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-generate', '--skip-seed'],
    { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' },
  );

  server = spawn(process.execPath, [path.join(API_DIR, 'dist', 'main.js')], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      API_PORT: String(PORT),
      // Redis is not part of this run: the journey must pass on the fallback.
      REDIS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[api] ${chunk}`));

  process.env.E2E_API_URL = `http://127.0.0.1:${PORT}`;

  await waitForReadiness();

  return async () => {
    server?.kill('SIGTERM');
  };
}

/** Poll `/health/ready`: the database probe is the boot signal. */
async function waitForReadiness(): Promise<void> {
  const url = `${process.env.E2E_API_URL}/api/v1/health/ready`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = (await response.json()) as { data: { database: string } };
        if (body.data?.database === 'up') {
          return;
        }
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  server?.kill('SIGKILL');
  throw new Error('the API did not become ready in time');
}
