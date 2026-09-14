/**
 * Config for the one-off performance probes in `scripts/*.perf.ts`.
 *
 * Separate from `vitest.config.ts` on purpose: those probes hit the LIVE
 * database and must never be picked up by `npm run test` / CI. The main config
 * includes only `__tests__/**` so they are invisible to it; this config is the
 * only way to run them, and it has to be asked for by name.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts --pool=threads
 */
import path from 'path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // node, not jsdom: these probes call server loaders, render nothing, and
    // jsdom only adds startup cost and a window global they must not use.
    environment: 'node',
    include: ['scripts/**/*.perf.ts'],
    globals: true,
    disableConsoleIntercept: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, '../__mocks__/server-only.ts'),
    },
  },
});
