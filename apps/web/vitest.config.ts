import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@nova/editor-core': path.resolve(__dirname, '../../packages/editor-core/src/index.ts'),
      '@nova/editor-konva': path.resolve(__dirname, '../../packages/editor-konva/src/index.ts'),
      '@nova/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@nova/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
