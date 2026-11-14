import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from 'ioredis';
import { getApiEnv } from './env';

interface MemoryCounter {
  hits: number;
  expiresAt: number;
  blockExpiresAt: number;
}

const LUA_INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

local blockPttl = redis.call('PTTL', blockKey)
if blockPttl > 0 then
  local currentHits = tonumber(redis.call('GET', hitsKey) or limit)
  return { currentHits, math.max(1, math.ceil(blockPttl / 1000)), 1, math.max(1, math.ceil(blockPttl / 1000)) }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end
local pttl = redis.call('PTTL', hitsKey)
if pttl < 0 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
  pttl = ttlMs
end

local isBlocked = 0
local timeToBlockExpire = 0
if hits > limit then
  isBlocked = 1
  if blockMs > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockMs)
    timeToBlockExpire = math.max(1, math.ceil(blockMs / 1000))
  else
    timeToBlockExpire = math.max(1, math.ceil(pttl / 1000))
  end
end

return { hits, math.max(1, math.ceil(pttl / 1000)), isBlocked, timeToBlockExpire }
`;

/** Distributed Redis rate-limiter storage for NestJS Throttler with safe local fallback. */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly memoryFallback = new Map<string, MemoryCounter>();

  constructor(options?: { redisUrl?: string; keyPrefix?: string }) {
    const url = options?.redisUrl ?? getApiEnv().redisUrl;
    this.keyPrefix =
      options?.keyPrefix ??
      (process.env.VITEST ? `nova:throttle:${randomUUID()}:` : 'nova:throttle:');
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    this.redis.on('error', () => {});
  }

  async onModuleDestroy(): Promise<void> {
    this.memoryFallback.clear();
    await this.redis.quit().catch(() => {});
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const namespaced = `${this.keyPrefix}${throttlerName}:${key}`;
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      const res = (await this.redis.eval(
        LUA_INCREMENT_SCRIPT,
        2,
        `${namespaced}:hits`,
        `${namespaced}:block`,
        String(Math.max(1, ttl)),
        String(limit),
        String(Math.max(0, blockDuration)),
      )) as [number, number, number, number];

      return {
        totalHits: Number(res[0] ?? 1),
        timeToExpire: Number(res[1] ?? Math.ceil(ttl / 1000)),
        isBlocked: Number(res[2] ?? 0) === 1,
        timeToBlockExpire: Number(res[3] ?? 0),
      };
    } catch {
      return this.incrementMemory(namespaced, ttl, limit, blockDuration);
    }
  }

  private incrementMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    const existing = this.memoryFallback.get(key);
    if (existing && existing.blockExpiresAt > now) {
      const remSec = Math.max(1, Math.ceil((existing.blockExpiresAt - now) / 1000));
      return {
        totalHits: existing.hits,
        timeToExpire: remSec,
        isBlocked: true,
        timeToBlockExpire: remSec,
      };
    }

    const record: MemoryCounter =
      existing && existing.expiresAt > now
        ? existing
        : { hits: 0, expiresAt: now + ttl, blockExpiresAt: 0 };

    record.hits += 1;
    const ttlSec = Math.max(1, Math.ceil((record.expiresAt - now) / 1000));
    const blocked = record.hits > limit;
    if (blocked && blockDuration > 0 && record.blockExpiresAt <= now) {
      record.blockExpiresAt = now + blockDuration;
    }
    this.memoryFallback.set(key, record);

    const blockSec = blocked
      ? blockDuration > 0
        ? Math.max(1, Math.ceil((record.blockExpiresAt - now) / 1000))
        : ttlSec
      : 0;

    return {
      totalHits: record.hits,
      timeToExpire: ttlSec,
      isBlocked: blocked,
      timeToBlockExpire: blockSec,
    };
  }
}
