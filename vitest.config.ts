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
  },
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
});
