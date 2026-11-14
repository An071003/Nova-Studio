import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, '../../../.env') });

const RealtimeConfigSchema = z.object({
  port: z.coerce.number().int().min(0).max(65535),
  host: z.string().min(1),
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  realtimeJwtSecret: z.string().min(16),
  maxConnectionsPerDoc: z.coerce.number().int().positive(),
  debounceMs: z.coerce.number().int().min(0),
  maxDebounceMs: z.coerce.number().int().min(0),
});

export type RealtimeConfig = z.infer<typeof RealtimeConfigSchema>;

/** Reads and Zod-validates realtime server configuration from environment variables with optional test overrides. */
export function getRealtimeConfig(overrides: Partial<RealtimeConfig> = {}): RealtimeConfig {
  return RealtimeConfigSchema.parse({
    port: overrides.port ?? process.env.REALTIME_PORT ?? 4001,
    host: overrides.host ?? process.env.REALTIME_HOST ?? '0.0.0.0',
    databaseUrl:
      overrides.databaseUrl ??
      process.env.DATABASE_URL ??
      'postgresql://nova:nova@localhost:5432/nova',
    redisUrl: overrides.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    realtimeJwtSecret:
      overrides.realtimeJwtSecret ??
      process.env.REALTIME_JWT_SECRET ??
      'dev-realtime-secret-change-in-production-32chars',
    maxConnectionsPerDoc:
      overrides.maxConnectionsPerDoc ?? process.env.REALTIME_MAX_CONNECTIONS_PER_DOC ?? 50,
    debounceMs: overrides.debounceMs ?? 2000,
    maxDebounceMs: overrides.maxDebounceMs ?? 10000,
  });
}
