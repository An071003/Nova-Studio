import { describe, expect, it } from 'vitest';
import { hashRefreshToken } from './auth.service';

describe('hashRefreshToken', () => {
  it('produces deterministic sha256 hex digest distinct from raw token', () => {
    const raw = 'sample-refresh-token-value';
    const digest1 = hashRefreshToken(raw);
    const digest2 = hashRefreshToken(raw);
    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64);
    expect(digest1).not.toBe(raw);
  });
});
