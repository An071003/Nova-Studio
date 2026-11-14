import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('architecture boundaries', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const eslint = new ESLint({ cwd: rootDir });

  it('rejects forbidden UI/renderer imports in editor-core', async () => {
    const sampleFile = path.resolve(rootDir, 'packages/editor-core/src/index.ts');
    const badCode = [
      `import React from 'react';`,
      `import Konva from 'konva';`,
      `export const broken = [React, Konva];`,
    ].join('\n');

    const [result] = await eslint.lintText(badCode, { filePath: sampleFile });
    const restricted = (result?.messages ?? []).filter(
      (m) => m.ruleId === 'no-restricted-imports',
    );
    expect(restricted.length).toBeGreaterThanOrEqual(2);
  }, 20000);

  it('rejects @nova/editor-core import inside apps/api', async () => {
    const apiFile = path.resolve(rootDir, 'apps/api/src/index.ts');
    const badCode = `import { EDITOR_CORE_VERSION } from '@nova/editor-core';\nexport const v = EDITOR_CORE_VERSION;\n`;
    const [result] = await eslint.lintText(badCode, { filePath: apiFile });
    const restricted = (result?.messages ?? []).filter(
      (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'import/no-restricted-paths',
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('rejects cross-app relative imports between apps/web and apps/api', async () => {
    const webFile = path.resolve(rootDir, 'apps/web/src/index.ts');
    const badCode = `import { API_SERVICE_VERSION } from '../../api/src/index.js';\nexport const v = API_SERVICE_VERSION;\n`;
    const [result] = await eslint.lintText(badCode, { filePath: webFile });
    const restricted = (result?.messages ?? []).filter(
      (m) => m.ruleId === 'import/no-restricted-paths',
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
