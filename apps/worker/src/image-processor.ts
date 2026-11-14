import sharp, { type Metadata } from 'sharp';
import {
  ALLOWED_ASSET_MIME_TYPES,
  ERROR_CODES,
  MAX_ASSET_SIZE_BYTES,
  NovaError,
  sanitizeSvgMarkup,
  type AllowedAssetMimeType,
} from '@nova/shared';

const EXPECTED_SHARP_FORMAT: Record<AllowedAssetMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export interface ProcessedAssetImage {
  mimeType: AllowedAssetMimeType;
  width: number;
  height: number;
  sizeBytes: number;
  sanitizedBuffer?: Buffer;
  thumbnailWebp: Buffer;
}

export async function processAssetImage(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<ProcessedAssetImage> {
  if (!ALLOWED_ASSET_MIME_TYPES.includes(declaredMimeType as AllowedAssetMimeType)) {
    throw new NovaError(
      ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
      `Unsupported asset MIME type: ${declaredMimeType}`,
    );
  }
  const mimeType = declaredMimeType as AllowedAssetMimeType;

  if (buffer.byteLength === 0) {
    throw new NovaError(ERROR_CODES.VALIDATION_FAILED, 'Uploaded file is empty');
  }
  if (buffer.byteLength > MAX_ASSET_SIZE_BYTES) {
    throw new NovaError(
      ERROR_CODES.ASSET_TOO_LARGE,
      'Uploaded asset exceeds the 25MB maximum size limit',
    );
  }

  let sourceBuffer = buffer;
  let sanitizedBuffer: Buffer | undefined;

  if (mimeType === 'image/svg+xml') {
    const svgCheck = sanitizeSvgMarkup(buffer.toString('utf8'));
    if (!svgCheck.safe) {
      throw new NovaError(
        ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
        svgCheck.reason ?? 'Invalid SVG asset payload',
      );
    }
    sourceBuffer = Buffer.from(svgCheck.sanitized, 'utf8');
    sanitizedBuffer = sourceBuffer;
  }

  let meta: Metadata;
  try {
    meta = await sharp(sourceBuffer).metadata();
  } catch {
    throw new NovaError(
      ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
      'Uploaded file is not a valid image',
    );
  }

  const expectedFormat = EXPECTED_SHARP_FORMAT[mimeType];
  if (meta.format !== expectedFormat) {
    throw new NovaError(
      ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
      `Uploaded file content (${meta.format ?? 'unknown'}) does not match ${mimeType}`,
    );
  }

  const width = Math.max(1, meta.width ?? (mimeType === 'image/svg+xml' ? 256 : 0));
  const height = Math.max(1, meta.height ?? (mimeType === 'image/svg+xml' ? 256 : 0));
  if (width <= 0 || height <= 0) {
    throw new NovaError(
      ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
      'Unable to determine valid image dimensions',
    );
  }

  const thumbnailWebp = await sharp(sourceBuffer)
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  return {
    mimeType,
    width,
    height,
    sizeBytes: sourceBuffer.byteLength,
    sanitizedBuffer,
    thumbnailWebp,
  };
}
