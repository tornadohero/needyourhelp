import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in Node, not in WeChat DevTools.
 *
 * Only `src/core/**` is covered: it holds the pure logic (envelope, session,
 * routes, money), while everything that touches `wx.*` stays in `src/platform`,
 * behind an injected transport. There are no decorators here, so the default
 * esbuild transform is enough — no extra toolchain.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
