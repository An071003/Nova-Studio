import { describe, expect, it } from 'vitest';
import { UI_TOKENS_VERSION } from './index.js';

describe('@nova/ui', () => {
  it('exports UI tokens version', () => {
    expect(UI_TOKENS_VERSION).toBe(1);
  });
});
