import { describe, expect, it } from 'vitest';
import { EDITOR_KONVA_VERSION } from './index.js';

describe('@nova/editor-konva', () => {
  it('exposes editor-konva version', () => {
    expect(EDITOR_KONVA_VERSION).toBe(1);
  });
});
