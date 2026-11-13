import { defineConfig } from 'vitest/config';

// App tests only; harness/ has its own test runners.
// `npm run coverage` enforces the NFR-4 floor of 80 % on src/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points: a real server (`npm start`) and the IMDb download/import (`npm run import:imdb`), not unit-tested.
      exclude: ['src/server.ts', 'src/import/cli.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
