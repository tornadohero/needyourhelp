import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// NestJS relies on decorator metadata for dependency injection, which esbuild
// (the vitest default) cannot emit. SWC replaces it for tests only.
export default defineConfig({
  plugins: [
    swc.vite({
      // Keep ESM output: vitest must be imported with `import`, not `require`.
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
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Database-backed tests live in `test/integration` and run through
    // `vitest.integration.config.ts` (they need a disposable PostgreSQL).
    exclude: ['**/node_modules/**', '**/dist/**', 'test/integration/**', 'test/e2e/**'],
  },
});
