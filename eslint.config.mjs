import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.vite/**',
      '.claude/**',
      '.worktrees/**',
      '.media-build/**',
      '.tmp-*/**',
      'artifacts/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      // Emscripten-generated glue (acquired by scripts/build-ufbx-wasm.mjs).
      'resources/ufbx/**',
      // Fork: local clone of the upstream repo used for comparisons
      // (see docs/myqy/git-rules.md §6); .gitignore does not cover ESLint.
      '上游作者项目/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
