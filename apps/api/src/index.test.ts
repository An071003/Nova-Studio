import { describe, expect, it } from 'vitest';
import { API_SERVICE_VERSION } from './index';

describe('api', () => {
  it('exposes api service version', () => {
    expect(API_SERVICE_VERSION).toBe(1);
  });
});
