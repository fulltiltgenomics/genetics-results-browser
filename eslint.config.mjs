// Flat config (.mjs because package.json has no "type": "module").
//
// Deliberately NOT type-aware: typescript-eslint's type-checked presets re-run the
// TypeScript program on every invocation, which would put a full tsc on the commit path.
// `npm run typecheck` and `npm run bff:typecheck` already cover that ground, and CI
// runs both on every PR.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'playwright-report',
      'test-results',
      // sibling worktrees carry their own copy of every source file; without this,
      // eslint reports each finding once per checked-out branch
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Only errors block a commit; warnings are advisory. Demoted rather than disabled
      // because it is a strictness preference, not a defect detector, and on adoption it
      // was 78 of the 133 errors — left as an error it would have blocked commits on
      // files whose types nobody was touching.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
