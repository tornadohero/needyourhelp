import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * Reset the integration database from the committed Prisma migrations.
 *
 * This is also the T002 acceptance check "fresh DB migration works": the whole
 * migration history is replayed from scratch on every integration run.
 */
export default function setup(): void {
  const url = process.env.DATABASE_TEST_URL;
  if (!url) {
    console.warn(
      '[integration] DATABASE_TEST_URL is not set — database integration tests are skipped.',
    );
    return;
  }

  execFileSync(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-generate', '--skip-seed'],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    },
  );
}
