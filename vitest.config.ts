import { defineConfig } from 'vitest/config';

// App tests only; harness/ has its own test runners.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
