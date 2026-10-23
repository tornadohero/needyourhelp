import { defineConfig } from 'vitest/config';

/**
 * Three-end E2E (T035).
 *
 * One server, three clients: the API runs as a real process, and the mini
 * program and the admin console drive it with their own modules over real HTTP.
 *
 * The two clients are consumed as **TypeScript source** (workspace exports point
 * at `src/`), so `deps.inline` is required: without it the linked packages would
 * be treated as external and Node would try to load `.ts` files.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Building and booting the API, then walking a whole journey.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One server for the whole run: the journey is one story, not eight.
    fileParallelism: false,
    server: {
      deps: {
        inline: [/@mentor/],
      },
    },
  },
});
