import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('counts requests up to limit and blocks once exceeded using Redis', async () => {
    const storage = new RedisThrottlerStorage({
      keyPrefix: `nova:throttle:unit:${randomUUID()}:`,
    });
    try {
      const r1 = await storage.increment('client-ip', 10_000, 2, 0, 'default');
      expect(r1.totalHits).toBe(1);
      expect(r1.isBlocked).toBe(false);
      expect(r1.timeToExpire).toBeGreaterThanOrEqual(1);

      const r2 = await storage.increment('client-ip', 10_000, 2, 0, 'default');
      expect(r2.totalHits).toBe(2);
      expect(r2.isBlocked).toBe(false);

      const r3 = await storage.increment('client-ip', 10_000, 2, 0, 'default');
      expect(r3.totalHits).toBe(3);
      expect(r3.isBlocked).toBe(true);
      expect(r3.timeToBlockExpire).toBeGreaterThanOrEqual(1);
    } finally {
      await storage.onModuleDestroy();
    }
  });
});
