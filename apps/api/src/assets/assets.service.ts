import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  ALLOWED_ASSET_MIME_TYPES,
  ASSET_PROCESS_QUEUE,
  ERROR_CODES,
  MAX_ASSET_SIZE_BYTES,
  NovaError,
  sanitizeSvgMarkup,
  type AllowedAssetMimeType,
  type AssetDto,
  type AssetProcessJob,
  type AssetUrlResponse,
  type CreateUploadUrlDto,
  type UploadUrlResponse,
} from '@nova/shared';
import type { Asset } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import sharp, { type Metadata } from 'sharp';
import { getApiEnv } from '../common/env';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';

const EXPECTED_SHARP_FORMAT: Record<AllowedAssetMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function toAssetDto(asset: Asset): AssetDto {
  return {
    id: asset.id,
    projectId: asset.projectId,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    status: asset.status,
    createdAt: asset.createdAt.toISOString(),
  };
}

async function readBodyWithinLimit(body: unknown, maxBytes: number): Promise<Buffer> {
  if (!body) {
    throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Uploaded object body is empty');
  }
  if (Buffer.isBuffer(body)) {
    if (body.byteLength > maxBytes) {
      throw new NovaError(ERROR_CODES.ASSET_TOO_LARGE, 'Uploaded file exceeds 25 MB limit');
    }
    return body;
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) {
      throw new NovaError(ERROR_CODES.ASSET_TOO_LARGE, 'Uploaded file exceeds 25 MB limit');
    }
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
    if (arr.byteLength > maxBytes) {
      throw new NovaError(ERROR_CODES.ASSET_TOO_LARGE, 'Uploaded file exceeds 25 MB limit');
    }
    return Buffer.from(arr);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      throw new NovaError(ERROR_CODES.ASSET_TOO_LARGE, 'Uploaded file exceeds 25 MB limit');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class AssetsService implements OnModuleDestroy {
  private readonly env = getApiEnv();
  private readonly s3Internal: S3Client;
  private readonly s3Public: S3Client;
  private readonly redis: Redis;
  private readonly assetQueue: Queue<AssetProcessJob>;

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
    this.assetQueue = new Queue<AssetProcessJob>(ASSET_PROCESS_QUEUE, {
      connection: this.redis,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.assetQueue.close().catch(() => {});
    await this.redis.quit().catch(() => {});
  }

  async createUploadUrl(
    userId: string,
    projectId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponse> {
    await this.permissions.assertProject(userId, projectId, 'asset.upload');

    if (!ALLOWED_ASSET_MIME_TYPES.includes(dto.mimeType as AllowedAssetMimeType)) {
      throw new NovaError(
        ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
        `Asset MIME type ${dto.mimeType} is not allowed`,
      );
    }

    if (dto.sizeBytes > MAX_ASSET_SIZE_BYTES) {
      throw new NovaError(
        ERROR_CODES.ASSET_TOO_LARGE,
        'Asset exceeds the maximum upload size of 25 MB',
      );
    }

    const assetId = randomUUID();
    const key = `projects/${projectId}/assets/${assetId}`;

    const asset = await this.prisma.asset.create({
      data: {
        id: assetId,
        projectId,
        key,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        status: 'PENDING',
        uploadedById: userId,
      },
    });

    const expiresIn = 300;
    const putUrl = await getSignedUrl(
      this.s3Public,
      new PutObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: key,
        ContentType: dto.mimeType,
      }),
      { expiresIn },
    );

    return {
      assetId: asset.id,
      putUrl,
      expiresIn,
    };
  }

  async confirmAsset(userId: string, assetId: string): Promise<{ asset: AssetDto }> {
    const existing = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!existing) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Asset not found');
    }

    await this.permissions.assertProject(userId, existing.projectId, 'asset.upload');

    let rawBuffer: Buffer;
    try {
      const fetched = await this.s3Internal.send(
        new GetObjectCommand({
          Bucket: this.env.s3Bucket,
          Key: existing.key,
        }),
      );
      if (fetched.ContentLength !== undefined && fetched.ContentLength > MAX_ASSET_SIZE_BYTES) {
        await this.markFailedAndDeleteObject(existing.id, existing.key);
        throw new NovaError(
          ERROR_CODES.ASSET_TOO_LARGE,
          'Uploaded asset exceeds the maximum size of 25 MB',
        );
      }
      rawBuffer = await readBodyWithinLimit(fetched.Body, MAX_ASSET_SIZE_BYTES);
    } catch (err) {
      if (err instanceof NovaError) {
        throw err;
      }
      await this.prisma.asset.update({
        where: { id: existing.id },
        data: { status: 'FAILED' },
      });
      throw new NovaError(
        ERROR_CODES.VALIDATION_FAILED,
        'Uploaded asset could not be read from object storage',
      );
    }

    if (rawBuffer.byteLength === 0) {
      await this.markFailedAndDeleteObject(existing.id, existing.key);
      throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Uploaded file is empty');
    }

    const mimeType = existing.mimeType as AllowedAssetMimeType;
    let finalBuffer = rawBuffer;
    if (mimeType === 'image/svg+xml') {
      const sanitized = sanitizeSvgMarkup(rawBuffer.toString('utf8'));
      if (!sanitized.safe) {
        await this.markFailedAndDeleteObject(existing.id, existing.key);
        throw new NovaError(
          ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
          sanitized.reason ?? 'SVG payload failed security sanitization',
        );
      }
      finalBuffer = Buffer.from(sanitized.sanitized, 'utf8');
      await this.s3Internal.send(
        new PutObjectCommand({
          Bucket: this.env.s3Bucket,
          Key: existing.key,
          Body: finalBuffer,
          ContentType: 'image/svg+xml',
        }),
      );
    }

    let meta: Metadata;
    try {
      meta = await sharp(finalBuffer).metadata();
    } catch {
      await this.markFailedAndDeleteObject(existing.id, existing.key);
      throw new NovaError(
        ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
        'Uploaded file content is not a valid image',
      );
    }

    const expectedFormat = EXPECTED_SHARP_FORMAT[mimeType];
    if (!expectedFormat || meta.format !== expectedFormat) {
      await this.markFailedAndDeleteObject(existing.id, existing.key);
      throw new NovaError(
        ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
        `Uploaded file format (${meta.format ?? 'unknown'}) does not match declared type ${existing.mimeType}`,
      );
    }

    const width = Math.max(1, meta.width ?? (mimeType === 'image/svg+xml' ? 256 : 0));
    const height = Math.max(1, meta.height ?? (mimeType === 'image/svg+xml' ? 256 : 0));
    if (width <= 0 || height <= 0) {
      await this.markFailedAndDeleteObject(existing.id, existing.key);
      throw new NovaError(
        ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
        'Could not determine image dimensions',
      );
    }

    const thumbBuffer = await sharp(finalBuffer)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await this.s3Internal.send(
      new PutObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: `projects/${existing.projectId}/thumbs/${existing.id}.webp`,
        Body: thumbBuffer,
        ContentType: 'image/webp',
      }),
    );

    await this.assetQueue
      .add('asset.process', {
        assetId: existing.id,
        projectId: existing.projectId,
        key: existing.key,
        mimeType: existing.mimeType,
      })
      .catch(() => {});

    const updated = await this.prisma.asset.update({
      where: { id: existing.id },
      data: {
        status: 'READY',
        width,
        height,
        sizeBytes: finalBuffer.byteLength,
      },
    });

    return { asset: toAssetDto(updated) };
  }

  async listProjectAssets(userId: string, projectId: string): Promise<{ assets: AssetDto[] }> {
    await this.permissions.assertProject(userId, projectId, 'project.view');
    const rows = await this.prisma.asset.findMany({
      where: { projectId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { assets: rows.map(toAssetDto) };
  }

  async getAssetUrl(userId: string, assetId: string): Promise<AssetUrlResponse> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Asset not found');
    }

    await this.permissions.assertProject(userId, asset.projectId, 'project.view');

    if (asset.status !== 'READY') {
      throw new NovaError(ERROR_CODES.CONFLICT, 'Asset is not ready yet');
    }

    const expiresIn = 600;
    const url = await getSignedUrl(
      this.s3Public,
      new GetObjectCommand({
        Bucket: this.env.s3Bucket,
        Key: asset.key,
      }),
      { expiresIn },
    );

    return { url, expiresIn };
  }

  private async markFailedAndDeleteObject(assetId: string, key: string): Promise<void> {
    await Promise.all([
      this.prisma.asset.update({
        where: { id: assetId },
        data: { status: 'FAILED' },
      }),
      this.s3Internal
        .send(
          new DeleteObjectCommand({
            Bucket: this.env.s3Bucket,
            Key: key,
          }),
        )
        .catch(() => {}),
    ]);
  }
}
