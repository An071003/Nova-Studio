import { describe, expect, it } from 'vitest';
import { EDITOR_CORE_VERSION } from './index.js';

describe('@nova/editor-core', () => {
  it('exports editor-core version', () => {
    expect(EDITOR_CORE_VERSION).toBe(1);
  });
});
