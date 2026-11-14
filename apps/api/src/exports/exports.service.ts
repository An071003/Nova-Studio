import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  ERROR_CODES,
  EXPORT_PROCESS_QUEUE,
  NovaError,
  renderCanvasNodesToSvg,
  type CanvasNode,
  type CreateExportDto,
  type ExportJobResponse,
  type ExportProcessJob,
  type ExportStatus,
} from '@nova/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { getApiEnv } from '../common/env';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';
import { decodeNodesFromYDocBytes } from './yjs-doc-nodes';

const DOC_REQUEST_CHANNEL_PREFIX = 'nova:doc-req:';
const EXPORT_REPLY_CHANNEL_PREFIX = 'nova:export-reply:';
const EXPORT_JOB_KEY_PREFIX = 'nova:export:';
const PROJECT_THUMBNAIL_WIDTH = 400;
const PROJECT_THUMBNAIL_HEIGHT = 225;
const PROJECT_THUMBNAIL_BG = '#1A1A1E';

interface StoredExportRecord {
  jobId: string;
  projectId: string;
  status: ExportStatus;
  width: number;
  height: number;
  key: string;
}

async function readS3StreamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new NovaError(ERROR_CODES.NOT_FOUND, 'Object body is empty');
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
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class ExportsService implements OnModuleDestroy {
  private readonly env = getApiEnv();
  private readonly s3Internal: S3Client;
  private readonly s3Public: S3Client;
  private readonly redis: Redis;
  private readonly redisSub: Redis;
  private readonly exportQueue: Queue<ExportProcessJob>;
  private readonly memoryJobs = new Map<string, StoredExportRecord>();
  private readonly pendingReplies = new Map<string, (raw: string) => void>();
  private subInitialized = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {
    const credentials = {
      accessKeyId: this.env.s3AccessKey,
      secretAccessKey: this.env.s3SecretKey,
    };
    this.s3Internal = new S3Client({
      endpoint: this.env.s3Endpoint,
      region: this.env.s3Region,
      forcePathStyle: this.env.s3ForcePathStyle,
      credentials,
    });
    this.s3Public = new S3Client({
      endpoint: this.env.s3PublicEndpoint,
      region: this.env.s3Region,
      forcePathStyle: this.env.s3ForcePathStyle,
      credentials,
    });
    this.redis = new Redis(this.env.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    this.redis.on('error', () => {});
    this.redisSub = new Redis(this.env.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    this.redisSub.on('error', () => {});
    this.redisSub.on('pmessage', (_pattern, channel, message) => {
      const handler = this.pendingReplies.get(channel);
      if (handler) {
        handler(message);
      }
    });
    this.exportQueue = new Queue<ExportProcessJob>(EXPORT_PROCESS_QUEUE, {
      connection: this.redis,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.pendingReplies.clear();
    await this.exportQueue.close().catch(() => {});
    await this.redisSub.quit().catch(() => {});
    await this.redis.quit().catch(() => {});
  }

  private async ensureReplySubscription(): Promise<boolean> {
    if (this.subInitialized) return true;
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      if (this.redisSub.status === 'wait') {
        await this.redisSub.connect();
      }
      await this.redisSub.psubscribe(`${EXPORT_REPLY_CHANNEL_PREFIX}*`);
      this.subInitialized = true;
      return true;
    } catch {
      return false;
    }
  }

  private async fetchLiveRealtimeDocBytes(projectId: string): Promise<Uint8Array | null> {
    const ready = await this.ensureReplySubscription();
    if (!ready) return null;

    const replyChannel = `${EXPORT_REPLY_CHANNEL_PREFIX}${randomUUID()}`;
    return new Promise<Uint8Array | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(replyChannel);
        resolve(null);
      }, 600);

      this.pendingReplies.set(replyChannel, (raw) => {
        clearTimeout(timer);
        this.pendingReplies.delete(replyChannel);
        try {
          const parsed = JSON.parse(raw) as { found?: boolean; stateBase64?: string };
          if (parsed.found && typeof parsed.stateBase64 === 'string' && parsed.stateBase64.length > 0) {
            resolve(Uint8Array.from(Buffer.from(parsed.stateBase64, 'base64')));
            return;
          }
        } catch {
          // ignore malformed response
        }
        resolve(null);
      });

      this.redis
        .publish(
          `${DOC_REQUEST_CHANNEL_PREFIX}${projectId}`,
          JSON.stringify({ replyChannel }),
        )
        .then((receivers) => {
          if (receivers === 0) {
            clearTimeout(timer);
            this.pendingReplies.delete(replyChannel);
            resolve(null);
          }
        })
        .catch(() => {
          clearTimeout(timer);
          this.pendingReplies.delete(replyChannel);
          resolve(null);
        });
    });
  }

  private async loadSceneNodes(
    projectId: string,
    overrideStateBase64?: string,
  ): Promise<{ nodes: CanvasNode[]; fromClientOverride: boolean }> {
    const liveBytes = await this.fetchLiveRealtimeDocBytes(projectId);
    if (liveBytes) {
      return { nodes: decodeNodesFromYDocBytes(liveBytes), fromClientOverride: false };
    }

    if (overrideStateBase64) {
      try {
        const bytes = Uint8Array.from(Buffer.from(overrideStateBase64, 'base64'));
        return { nodes: decodeNodesFromYDocBytes(bytes), fromClientOverride: true };
      } catch {
        throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Invalid Yjs state payload');
      }
    }

    const row = await this.prisma.projectDocument.findUnique({
      where: { projectId },
      select: { state: true },
    });
    if (!row?.state) {
      return { nodes: [], fromClientOverride: false };
    }
    return {
      nodes: decodeNodesFromYDocBytes(Uint8Array.from(row.state)),
      fromClientOverride: false,
    };
  }

  private async loadEmbeddedImages(
    projectId: string,
    nodes: readonly CanvasNode[],
  ): Promise<{ embeddedImages: Map<string, string>; assetKeys: Record<string, string> }> {
    const embeddedImages = new Map<string, string>();
    const assetKeys: Record<string, string> = {};
    const assetIds = Array.from(
      new Set(
        nodes
          .filter((n) => n.type === 'image' && n.visible && Boolean(n.assetId))
          .map((n) => n.assetId as string),
      ),
    );
    if (assetIds.length === 0) {
      return { embeddedImages, assetKeys };
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        projectId,
        id: { in: assetIds },
        status: 'READY',
      },
      select: {
        id: true,
        key: true,
        mimeType: true,
      },
    });

    await Promise.all(
      assets.map(async (asset) => {
        try {
          const obj = await this.s3Internal.send(
            new GetObjectCommand({ Bucket: this.env.s3Bucket, Key: asset.key }),
          );
          const buf = await readS3StreamToBuffer(obj.Body);
          assetKeys[asset.id] = asset.key;
          embeddedImages.set(
            asset.id,
            `data:${asset.mimeType};base64,${buf.toString('base64')}`,
          );
        } catch {
          // Skip missing S3 objects and render fallback box cleanly
        }
      }),
    );

    return { embeddedImages, assetKeys };
  }

  private async renderAndStoreProjectThumbnail(
    projectId: string,
    nodes: readonly CanvasNode[],
    embeddedImages: ReadonlyMap<string, string>,
  ): Promise<string> {
    const rendered = renderCanvasNodesToSvg(nodes, {
      scale: 1,
      embeddedImages,
    });
    const webp = await sharp(Buffer.from(rendered.svg, 'utf8'))
      .flatten({ background: PROJECT_THUMBNAIL_BG })
      .resize(PROJECT_THUMBNAIL_WIDTH, PROJECT_THUMBNAIL_HEIGHT, {
        fit: 'contain',
        background: PROJECT_THUMBNAIL_BG,
      })
      .webp({ quality: 82 })
      .toBuffer();

    const thumbnailKey = `projects/${projectId}/project-thumb.webp`;
    await this.s3Internal.send(
      new PutObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: thumbnailKey,
        Body: webp,
        ContentType: 'image/webp',
      }),
    );
    await this.prisma.project.update({
      where: { id: projectId },
      data: { thumbnailKey },
    });
    return thumbnailKey;
  }

  private async signExportUrl(key: string, jobId: string): Promise<string> {
    return getSignedUrl(
      this.s3Public,
      new GetObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="nova-export-${jobId}.png"`,
      }),
      { expiresIn: 600 },
    );
  }

  private async persistJobRecord(record: StoredExportRecord): Promise<void> {
    this.memoryJobs.set(record.jobId, record);
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      await this.redis.set(
        `${EXPORT_JOB_KEY_PREFIX}${record.jobId}`,
        JSON.stringify(record),
        'EX',
        3600,
      );
    } catch {
      // In-memory map still serves job status in single-instance/dev mode
    }
  }

  async createExport(
    userId: string,
    projectId: string,
    dto: CreateExportDto,
  ): Promise<ExportJobResponse> {
    const access = await this.permissions.assertProject(userId, projectId, 'project.export');
    const canEdit = access.role === 'OWNER' || access.role === 'EDITOR';
    const allowedOverride = canEdit ? dto.stateBase64 : undefined;

    const { nodes, fromClientOverride } = await this.loadSceneNodes(projectId, allowedOverride);
    const { embeddedImages, assetKeys } = await this.loadEmbeddedImages(projectId, nodes);

    const rendered = renderCanvasNodesToSvg(nodes, {
      scale: dto.scale,
      nodeIds: dto.nodeIds,
      background: dto.background,
      embeddedImages,
    });
    const pngBuffer = await sharp(Buffer.from(rendered.svg, 'utf8'))
      .png({ compressionLevel: 9 })
      .toBuffer();

    const jobId = randomUUID();
    const key = `projects/${projectId}/exports/${jobId}.png`;
    await this.s3Internal.send(
      new PutObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: key,
        Body: pngBuffer,
        ContentType: 'image/png',
      }),
    );

    let thumbnailKey: string | undefined;
    if (!fromClientOverride || canEdit) {
      thumbnailKey = await this.renderAndStoreProjectThumbnail(
        projectId,
        nodes,
        embeddedImages,
      );
    }

    const record: StoredExportRecord = {
      jobId,
      projectId,
      status: 'READY',
      width: rendered.width,
      height: rendered.height,
      key,
    };
    await this.persistJobRecord(record);

    await this.exportQueue
      .add('export', {
        jobId,
        projectId,
        format: dto.format,
        scale: dto.scale,
        nodeIds: dto.nodeIds,
        background: dto.background,
        key,
        thumbnailKey,
        nodes,
        assetKeys,
      })
      .catch(() => {});

    const url = await this.signExportUrl(key, jobId);
    return {
      jobId,
      status: 'READY',
      width: rendered.width,
      height: rendered.height,
      url,
    };
  }

  async getExportJob(userId: string, jobId: string): Promise<ExportJobResponse> {
    let record = this.memoryJobs.get(jobId) ?? null;
    if (!record) {
      try {
        if (this.redis.status === 'wait') {
          await this.redis.connect();
        }
        const raw = await this.redis.get(`${EXPORT_JOB_KEY_PREFIX}${jobId}`);
        if (raw) {
          record = JSON.parse(raw) as StoredExportRecord;
        }
      } catch {
        // ignore Redis lookup failure
      }
    }

    if (!record) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Export job not found');
    }

    await this.permissions.assertProject(userId, record.projectId, 'project.export');
    const url =
      record.status === 'READY' ? await this.signExportUrl(record.key, record.jobId) : undefined;

    return {
      jobId: record.jobId,
      status: record.status,
      width: record.width,
      height: record.height,
      url,
    };
  }

  async getProjectThumbnail(
    userId: string,
    projectId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    await this.permissions.assertProject(userId, projectId, 'project.view');
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { thumbnailKey: true, deletedAt: true },
    });
    if (!project || project.deletedAt || !project.thumbnailKey) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Project thumbnail not found');
    }

    try {
      const obj = await this.s3Internal.send(
        new GetObjectCommand({
          Bucket: this.env.s3Bucket,
          Key: project.thumbnailKey,
        }),
      );
      const buffer = await readS3StreamToBuffer(obj.Body);
      return { buffer, contentType: 'image/webp' };
    } catch {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Project thumbnail not found');
    }
  }

  async refreshProjectThumbnail(
    userId: string,
    projectId: string,
  ): Promise<{ thumbnailUrl: string }> {
    await this.permissions.assertProject(userId, projectId, 'canvas.edit');
    const { nodes } = await this.loadSceneNodes(projectId);
    const { embeddedImages } = await this.loadEmbeddedImages(projectId, nodes);
    await this.renderAndStoreProjectThumbnail(projectId, nodes, embeddedImages);
    return { thumbnailUrl: `/api/v1/projects/${projectId}/thumbnail` };
  }
}
