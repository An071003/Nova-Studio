import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ASSET_PROCESS_QUEUE,
  AssetProcessJobSchema,
  type AssetProcessJob,
} from '@nova/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { processAssetImage } from './image-processor.js';

export function thumbnailKeyForAsset(projectId: string, assetId: string): string {
  return `projects/${projectId}/thumbs/${assetId}.webp`;
}

export interface AssetWorkerOptions {
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3ForcePathStyle: boolean;
}

async function readStreamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty S3 response body');
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray ===
      'function'
  ) {
    const arr = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(arr);
  }
  throw new Error('Unsupported S3 body stream type');
}

export function createAssetWorker(options: AssetWorkerOptions): {
  worker: Worker<AssetProcessJob>;
  close: () => Promise<void>;
} {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const s3 = new S3Client({
    endpoint: options.s3Endpoint,
    region: options.s3Region,
    forcePathStyle: options.s3ForcePathStyle,
    credentials: {
      accessKeyId: options.s3AccessKey,
      secretAccessKey: options.s3SecretKey,
    },
  });

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
      const rawBuffer = await readStreamToBuffer(fetched.Body);
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
