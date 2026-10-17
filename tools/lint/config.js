// ESLint for the app (NFR-4). Lives in tools/lint because typescript-eslint needs the TypeScript 6
// compiler API; the app itself type-checks with TypeScript 7 (`npm run typecheck`).
// Loaded by the root eslint.config.js, so package imports resolve from tools/lint. Run `npm run lint`.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['src/**/*.ts', 'test/**/*.ts'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
});
