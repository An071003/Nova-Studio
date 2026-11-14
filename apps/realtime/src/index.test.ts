import { describe, expect, it } from 'vitest';
import { REALTIME_SERVICE_VERSION } from './index.js';

describe('realtime', () => {
  it('exposes realtime service version', () => {
    expect(REALTIME_SERVICE_VERSION).toBe(1);
  });
});
