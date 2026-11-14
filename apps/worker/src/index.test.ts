import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, MAX_ASSET_SIZE_BYTES, NovaError } from '@nova/shared';
import { processAssetImage, thumbnailKeyForAsset } from './index.js';

describe('worker asset processor', () => {
  it('extracts PNG dimensions and generates a WebP thumbnail', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 480,
        height: 320,
        channels: 4,
        background: { r: 124, g: 92, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await processAssetImage(pngBuffer, 'image/png');
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(480);
    expect(result.height).toBe(320);
    expect(result.sizeBytes).toBe(pngBuffer.byteLength);

    const thumbMeta = await sharp(result.thumbnailWebp).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(256);
    expect(thumbMeta.height).toBeLessThanOrEqual(256);
    expect(thumbnailKeyForAsset('proj_1', 'asset_1')).toBe('projects/proj_1/thumbs/asset_1.webp');
  });

  it('rejects spoofed MIME bytes when sharp magic bytes do not match', async () => {
    const spoofed = Buffer.from('this is plain text pretending to be a png', 'utf8');
    await expect(processAssetImage(spoofed, 'image/png')).rejects.toMatchObject({
      code: ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
    });
  });

  it('sanitizes XSS payloads inside SVG assets and creates a WebP thumbnail', async () => {
    const dirtySvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="alert(1)"><script>alert(2)</script><rect width="120" height="80" fill="#4ADE80"/></svg>',
      'utf8',
    );
    const result = await processAssetImage(dirtySvg, 'image/svg+xml');
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
    expect(result.sanitizedBuffer?.toString('utf8')).not.toMatch(/<script|onload=/i);

    const thumbMeta = await sharp(result.thumbnailWebp).metadata();
    expect(thumbMeta.format).toBe('webp');
  });

  it('rejects buffers exceeding MAX_ASSET_SIZE_BYTES', async () => {
    const oversized = Buffer.alloc(MAX_ASSET_SIZE_BYTES + 1, 0);
    let captured: unknown;
    try {
      await processAssetImage(oversized, 'image/png');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(NovaError);
    expect((captured as NovaError).code).toBe(ERROR_CODES.ASSET_TOO_LARGE);
  });
});
