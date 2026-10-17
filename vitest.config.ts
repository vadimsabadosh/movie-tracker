import { defineConfig } from 'vitest/config';

// App tests only; harness/ has its own test runners.
// `npm run coverage` enforces the NFR-4 floor of 80 % on src/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry point: starts a real server, exercised by `npm start`, not by tests.
      exclude: ['src/server.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
