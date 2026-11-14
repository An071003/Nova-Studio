import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { DEFAULT_AUTO_VERSION_INTERVAL_MS, DEFAULT_MAX_AUTO_VERSIONS } from './version-worker.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, '../../../.env') });

const WorkerConfigSchema = z.object({
  databaseUrl: z.string().min(1),
  redisUrl: z.string().min(1),
  s3Endpoint: z.string().min(1),
  s3Region: z.string().min(1),
  s3Bucket: z.string().min(1),
  s3AccessKey: z.string().min(1),
  s3SecretKey: z.string().min(1),
  s3ForcePathStyle: z.boolean(),
  autoVersionIntervalMs: z.coerce.number().int().positive(),
  maxAutoVersions: z.coerce.number().int().positive(),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

/** Parses and Zod-validates worker runtime configuration from environment variables and optional overrides. */
export function getWorkerConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  const rawForcePathStyle = process.env.S3_FORCE_PATH_STYLE;
  const forcePathStyle =
    overrides.s3ForcePathStyle ??
    (rawForcePathStyle === undefined ? true : rawForcePathStyle === 'true');

  return WorkerConfigSchema.parse({
    databaseUrl:
      overrides.databaseUrl ??
      process.env.DATABASE_URL ??
      'postgresql://nova:nova@localhost:5432/nova',
    redisUrl: overrides.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    s3Endpoint: overrides.s3Endpoint ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    s3Region: overrides.s3Region ?? process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: overrides.s3Bucket ?? process.env.S3_BUCKET ?? 'nova-assets',
    s3AccessKey: overrides.s3AccessKey ?? process.env.S3_ACCESS_KEY ?? 'minio',
    s3SecretKey: overrides.s3SecretKey ?? process.env.S3_SECRET_KEY ?? 'minio12345',
    s3ForcePathStyle: forcePathStyle,
    autoVersionIntervalMs:
      overrides.autoVersionIntervalMs ??
      process.env.AUTO_VERSION_INTERVAL_MS ??
      DEFAULT_AUTO_VERSION_INTERVAL_MS,
    maxAutoVersions:
      overrides.maxAutoVersions ?? process.env.MAX_AUTO_VERSIONS ?? DEFAULT_MAX_AUTO_VERSIONS,
  });
}
