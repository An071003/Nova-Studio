import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    conditions: ['browser'],
    alias: [
      { find: /^konva$/, replacement: require.resolve('konva/lib/index.js') },
      { find: '@nova/editor-core', replacement: path.resolve(__dirname, '../../packages/editor-core/src/index.ts') },
      { find: '@nova/editor-konva', replacement: path.resolve(__dirname, '../../packages/editor-konva/src/index.ts') },
      { find: '@nova/shared', replacement: path.resolve(__dirname, '../../packages/shared/src/index.ts') },
      { find: '@nova/ui', replacement: path.resolve(__dirname, '../../packages/ui/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
