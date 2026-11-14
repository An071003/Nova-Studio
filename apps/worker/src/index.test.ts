import { describe, expect, it } from 'vitest';
import { WORKER_SERVICE_VERSION } from './index.js';

describe('worker', () => {
  it('exposes worker service version', () => {
    expect(WORKER_SERVICE_VERSION).toBe(1);
  });
});
