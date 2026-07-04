import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // jsdom so React component tests (.test.tsx) can render; the pure-logic
    // .test.ts suites run fine under jsdom too.
    environment: 'jsdom',
    include: ['__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['vitest.setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // `all: false` (default) reports only files actually exercised by
      // tests — repo-wide coverage isn't tracked yet, so a blanket
      // `all: true` would just report the untested legacy surface as 0%.
      // Per-task 100% coverage gates during feature work scope `include`
      // via the CLI (`--coverage.include=<glob>`) rather than here, so this
      // block stays a safe default for the whole repo.
    },
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
