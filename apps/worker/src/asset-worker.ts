import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  ASSET_PROCESS_QUEUE,
  AssetProcessJobSchema,
  type AssetProcessJob,
} from '@nova/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { processAssetImage } from './image-processor.js';
import {
  createWorkerS3Client,
  readS3BodyToBuffer,
  type S3ConnectionOptions,
} from './s3-utils.js';

export function thumbnailKeyForAsset(projectId: string, assetId: string): string {
  return `projects/${projectId}/thumbs/${assetId}.webp`;
}

export interface AssetWorkerOptions extends S3ConnectionOptions {
  redisUrl: string;
}

export function createAssetWorker(options: AssetWorkerOptions): {
  worker: Worker<AssetProcessJob>;
  close: () => Promise<void>;
} {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const s3 = createWorkerS3Client(options);

  const worker = new Worker<AssetProcessJob>(
    ASSET_PROCESS_QUEUE,
    async (job: Job<AssetProcessJob>) => {
      const payload = AssetProcessJobSchema.parse(job.data);
      const fetched = await s3.send(
        new GetObjectCommand({
          Bucket: options.s3Bucket,
          Key: payload.key,
        }),
      );
      const rawBuffer = await readS3BodyToBuffer(fetched.Body);
      const processed = await processAssetImage(rawBuffer, payload.mimeType);

      if (processed.sanitizedBuffer) {
        await s3.send(
          new PutObjectCommand({
            Bucket: options.s3Bucket,
            Key: payload.key,
            Body: processed.sanitizedBuffer,
            ContentType: payload.mimeType,
          }),
        );
      }

      const thumbKey = thumbnailKeyForAsset(payload.projectId, payload.assetId);
      await s3.send(
        new PutObjectCommand({
          Bucket: options.s3Bucket,
          Key: thumbKey,
          Body: processed.thumbnailWebp,
          ContentType: 'image/webp',
        }),
      );

      return {
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.sizeBytes,
        thumbnailKey: thumbKey,
      };
    },
    {
      connection,
      concurrency: 4,
    },
  );

  return {
    worker,
    close: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}
