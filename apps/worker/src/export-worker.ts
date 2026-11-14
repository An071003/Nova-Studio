import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  EXPORT_PROCESS_QUEUE,
  ExportProcessJobSchema,
  renderCanvasNodesToSvg,
  type CanvasNode,
  type ExportProcessJob,
} from '@nova/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import {
  createWorkerS3Client,
  readS3BodyToBuffer,
  type S3ConnectionOptions,
} from './s3-utils.js';

export const PROJECT_THUMBNAIL_WIDTH = 400;
export const PROJECT_THUMBNAIL_HEIGHT = 225;
export const PROJECT_THUMBNAIL_BG = '#1A1A1E';

export function projectThumbnailKey(projectId: string): string {
  return `projects/${projectId}/project-thumb.webp`;
}

export interface RenderScenePngInput {
  nodes: readonly CanvasNode[];
  scale?: number;
  nodeIds?: readonly string[];
  pageId?: string;
  background?: string | null;
  padding?: number;
  embeddedImages?: ReadonlyMap<string, string>;
}

export interface RenderedPngResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/** Renders scene nodes deterministically to PNG at the requested scale using Sharp/librsvg. */
export async function renderScenePngBuffer(
  input: RenderScenePngInput,
): Promise<RenderedPngResult> {
  const rendered = renderCanvasNodesToSvg(input.nodes, {
    scale: input.scale,
    nodeIds: input.nodeIds,
    pageId: input.pageId,
    background: input.background,
    padding: input.padding,
    embeddedImages: input.embeddedImages,
  });

  const buffer = await sharp(Buffer.from(rendered.svg, 'utf8'))
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    buffer,
    width: rendered.width,
    height: rendered.height,
  };
}

export interface RenderSceneThumbnailInput {
  nodes: readonly CanvasNode[];
  pageId?: string;
  background?: string | null;
  embeddedImages?: ReadonlyMap<string, string>;
}

/** Renders a 400x225 WebP preview thumbnail covering all nodes on the default page. */
export async function renderSceneThumbnailWebp(
  input: RenderSceneThumbnailInput,
): Promise<Buffer> {
  const rendered = renderCanvasNodesToSvg(input.nodes, {
    scale: 1,
    pageId: input.pageId,
    background: input.background,
    embeddedImages: input.embeddedImages,
  });

  return sharp(Buffer.from(rendered.svg, 'utf8'))
    .flatten({ background: PROJECT_THUMBNAIL_BG })
    .resize(PROJECT_THUMBNAIL_WIDTH, PROJECT_THUMBNAIL_HEIGHT, {
      fit: 'contain',
      background: PROJECT_THUMBNAIL_BG,
    })
    .webp({ quality: 82 })
    .toBuffer();
}

function sniffMimeFromBuffer(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

export interface ExportWorkerOptions extends S3ConnectionOptions {
  redisUrl: string;
}

/** Starts a BullMQ worker processing asynchronous scene PNG exports and thumbnail refreshes. */
export function createExportWorker(options: ExportWorkerOptions): {
  worker: Worker<ExportProcessJob>;
  close: () => Promise<void>;
} {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });

  const s3 = createWorkerS3Client(options);

  const worker = new Worker<ExportProcessJob>(
    EXPORT_PROCESS_QUEUE,
    async (job: Job<ExportProcessJob>) => {
      const payload = ExportProcessJobSchema.parse(job.data);
      const nodes = payload.nodes ?? [];
      const embeddedImages = new Map<string, string>();

      if (payload.assetKeys) {
        await Promise.all(
          Object.entries(payload.assetKeys).map(async ([assetId, key]) => {
            const fetched = await s3.send(
              new GetObjectCommand({ Bucket: options.s3Bucket, Key: key }),
            );
            const raw = await readS3BodyToBuffer(fetched.Body);
            const mime = sniffMimeFromBuffer(raw);
            embeddedImages.set(assetId, `data:${mime};base64,${raw.toString('base64')}`);
          }),
        );
      }

      const png = await renderScenePngBuffer({
        nodes,
        scale: payload.scale,
        nodeIds: payload.nodeIds,
        background: payload.background,
        embeddedImages,
      });

      await s3.send(
        new PutObjectCommand({
          Bucket: options.s3Bucket,
          Key: payload.key,
          Body: png.buffer,
          ContentType: 'image/png',
        }),
      );

      if (payload.thumbnailKey) {
        const thumb = await renderSceneThumbnailWebp({
          nodes,
          embeddedImages,
        });
        await s3.send(
          new PutObjectCommand({
            Bucket: options.s3Bucket,
            Key: payload.thumbnailKey,
            Body: thumb,
            ContentType: 'image/webp',
          }),
        );
      }

      return {
        jobId: payload.jobId,
        key: payload.key,
        width: png.width,
        height: png.height,
      };
    },
    {
      connection,
      concurrency: 2,
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
