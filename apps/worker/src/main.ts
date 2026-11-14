import { PrismaClient } from '@prisma/client';
import { createAssetWorker } from './asset-worker.js';
import { getWorkerConfig } from './config.js';
import { createExportWorker } from './export-worker.js';
import { createAutoVersionWorker } from './version-worker.js';

async function main(): Promise<void> {
  const config = getWorkerConfig();
  const prisma = new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });
  await prisma.$connect();

  const s3Opts = {
    redisUrl: config.redisUrl,
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3Bucket: config.s3Bucket,
    s3AccessKey: config.s3AccessKey,
    s3SecretKey: config.s3SecretKey,
    s3ForcePathStyle: config.s3ForcePathStyle,
  };

  const assetWorker = createAssetWorker(s3Opts);
  const exportWorker = createExportWorker(s3Opts);
  const autoVersionWorker = createAutoVersionWorker({
    redisUrl: config.redisUrl,
    prisma,
    maxAutoVersions: config.maxAutoVersions,
  });

  await autoVersionWorker.schedule(config.autoVersionIntervalMs);
  // eslint-disable-next-line no-console
  console.log('[worker] NOVA background workers listening (asset, export, auto-version)');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[worker] Shutting down on ${signal}`);
    try {
      await Promise.all([
        assetWorker.close(),
        exportWorker.close(),
        autoVersionWorker.close(),
      ]);
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[worker] Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main();
