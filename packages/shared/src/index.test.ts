import { describe, expect, it } from 'vitest';
import { SHARED_VERSION } from './index.js';

describe('@nova/shared', () => {
  it('exports shared version', () => {
    expect(SHARED_VERSION).toBe(1);
  });
});
