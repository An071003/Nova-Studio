import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

const rootDir = import.meta.dirname;

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: [
            path.join(rootDir, 'packages/*/tsconfig.json'),
            path.join(rootDir, 'apps/*/tsconfig.json'),
          ],
        },
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'import/no-restricted-paths': [
        'error',
        {
          basePath: rootDir,
          zones: [
            // apps/* cannot import each other
            { target: './apps/web', from: './apps/api' },
            { target: './apps/web', from: './apps/realtime' },
            { target: './apps/web', from: './apps/worker' },
            { target: './apps/api', from: './apps/web' },
            { target: './apps/api', from: './apps/realtime' },
            { target: './apps/api', from: './apps/worker' },
            { target: './apps/realtime', from: './apps/web' },
            { target: './apps/realtime', from: './apps/api' },
            { target: './apps/realtime', from: './apps/worker' },
            { target: './apps/worker', from: './apps/web' },
            { target: './apps/worker', from: './apps/api' },
            { target: './apps/worker', from: './apps/realtime' },
            // packages/shared depends on nothing else in the repo
            { target: './packages/shared', from: './packages/editor-core' },
            { target: './packages/shared', from: './packages/editor-konva' },
            { target: './packages/shared', from: './packages/ui' },
            { target: './packages/shared', from: './apps' },
            // packages/editor-core only depends on packages/shared
            { target: './packages/editor-core', from: './packages/editor-konva' },
            { target: './packages/editor-core', from: './packages/ui' },
            { target: './packages/editor-core', from: './apps' },
            // packages/editor-konva only depends on editor-core, shared
            { target: './packages/editor-konva', from: './packages/ui' },
            { target: './packages/editor-konva', from: './apps' },
            // packages/ui has no business logic from editor-core/konva/shared or apps
            { target: './packages/ui', from: './packages/editor-core' },
            { target: './packages/ui', from: './packages/editor-konva' },
            { target: './packages/ui', from: './apps' },
            // apps/api and apps/worker only import shared
            { target: './apps/api', from: './packages/editor-core' },
            { target: './apps/api', from: './packages/editor-konva' },
            { target: './apps/api', from: './packages/ui' },
            { target: './apps/worker', from: './packages/editor-core' },
            { target: './apps/worker', from: './packages/editor-konva' },
            { target: './apps/worker', from: './packages/ui' },
            // apps/realtime only imports shared and editor-core
            { target: './apps/realtime', from: './packages/editor-konva' },
            { target: './apps/realtime', from: './packages/ui' },
          ],
        },
      ],
    },
  },
  // Specific package-level import restrictions (10-architecture-boundaries.md)
  {
    files: ['packages/shared/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@nova/*', 'react', 'react-dom', 'next', 'konva', 'react-konva', 'yjs'],
        },
      ],
    },
  },
  {
    files: ['packages/editor-core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'editor-core must remain headless (no React).' },
            { name: 'react-dom', message: 'editor-core must remain headless (no React DOM).' },
            { name: 'next', message: 'editor-core must remain headless (no Next.js).' },
            { name: 'konva', message: 'editor-core must remain renderer-agnostic (no Konva).' },
            { name: 'react-konva', message: 'editor-core must remain renderer-agnostic.' },
            { name: '@nova/editor-konva', message: 'editor-core cannot import editor-konva.' },
            { name: '@nova/ui', message: 'editor-core cannot import ui.' },
          ],
          patterns: ['next/*'],
        },
      ],
    },
  },
  {
    files: ['packages/editor-konva/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nova/ui', message: 'editor-konva cannot import ui.' },
            { name: 'next', message: 'editor-konva cannot import next.' },
          ],
          patterns: ['next/*'],
        },
      ],
    },
  },
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nova/editor-core', message: 'ui cannot contain editor business logic.' },
            { name: '@nova/editor-konva', message: 'ui cannot import editor-konva.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.{ts,tsx}', 'apps/worker/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nova/editor-core', message: 'api/worker only import @nova/shared.' },
            { name: '@nova/editor-konva', message: 'api/worker cannot import editor-konva.' },
            { name: '@nova/ui', message: 'api/worker cannot import ui.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/realtime/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nova/editor-konva', message: 'realtime cannot import editor-konva.' },
            { name: '@nova/ui', message: 'realtime cannot import ui.' },
          ],
        },
      ],
    },
  },
);
