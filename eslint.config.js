import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import path from 'path';
import tsParser from '@typescript-eslint/parser';

// mimic CommonJS dirname in an ES module
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  // ESLintRC-style extends
  ...compat.extends('eslint:recommended', 'plugin:@typescript-eslint/recommended'),

  // environments
  ...compat.env({ node: true, jest: true }),

  // plugins
  ...compat.plugins('@typescript-eslint'),

  // project-specific settings for TS source
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    rules: {
      // custom rule overrides go here
    },
  },

  // ignore patterns (replaces the old .eslintignore)
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
