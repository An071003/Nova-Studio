import { describe, expect, it } from 'vitest';
import { WORKSPACE_CONFIG_VERSION } from './index.js';

describe('@nova/config', () => {
  it('exposes workspace config version', () => {
    expect(WORKSPACE_CONFIG_VERSION).toBe(1);
  });
});
