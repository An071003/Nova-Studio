import { describe, expect, it } from 'vitest';
import { WEB_APP_VERSION } from './index.js';

describe('web', () => {
  it('connects all workspace libraries', () => {
    expect(WEB_APP_VERSION).toBe(4);
  });
});
