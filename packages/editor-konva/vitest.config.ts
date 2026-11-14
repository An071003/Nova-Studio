import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    conditions: ['browser'],
    alias: [
      { find: /^konva$/, replacement: require.resolve('konva/lib/index.js') },
      { find: '@nova/editor-core', replacement: path.resolve(__dirname, '../editor-core/src/index.ts') },
      { find: '@nova/shared', replacement: path.resolve(__dirname, '../shared/src/index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
