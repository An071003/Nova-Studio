import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_ID,
  ERROR_CODES,
  MAX_ASSET_SIZE_BYTES,
  NovaError,
  type CanvasNode,
} from '@nova/shared';
import {
  DEFAULT_MAX_AUTO_VERSIONS,
  processAssetImage,
  projectThumbnailKey,
  renderScenePngBuffer,
  renderSceneThumbnailWebp,
  runAutoVersionSweep,
  thumbnailKeyForAsset,
  type AutoVersionCandidateProject,
  type AutoVersionStore,
} from './index.js';

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

describe('worker auto-version sweep', () => {
  it('creates Auto snapshot when doc changed, skips unchanged state, and prunes beyond maxAutoVersions', async () => {
    interface StoredVersion {
      id: string;
      projectId: string;
      label: string;
      state: Uint8Array;
      createdAt: Date;
      isAuto: boolean;
    }

    const baseTime = Date.now() - 60_000;
    const versions: StoredVersion[] = [
      {
        id: 'ver-1',
        projectId: 'proj-changed',
        label: 'Old auto 1',
        state: Uint8Array.from([1, 2, 3]),
        createdAt: new Date(baseTime - 30_000),
        isAuto: true,
      },
      {
        id: 'ver-2',
        projectId: 'proj-changed',
        label: 'Old auto 2',
        state: Uint8Array.from([1, 2, 4]),
        createdAt: new Date(baseTime - 20_000),
        isAuto: true,
      },
      {
        id: 'ver-unchanged',
        projectId: 'proj-same',
        label: 'Current',
        state: Uint8Array.from([9, 9, 9]),
        createdAt: new Date(baseTime - 10_000),
        isAuto: false,
      },
    ];

    const projects: AutoVersionCandidateProject[] = [
      {
        id: 'proj-changed',
        createdById: 'user-owner',
        document: {
          state: Uint8Array.from([1, 2, 5]),
          updatedAt: new Date(baseTime),
        },
      },
      {
        id: 'proj-same',
        createdById: 'user-owner',
        document: {
          state: Uint8Array.from([9, 9, 9]),
          updatedAt: new Date(baseTime),
        },
      },
      {
        id: 'proj-first',
        createdById: 'user-owner',
        document: {
          state: Uint8Array.from([7, 7]),
          updatedAt: new Date(baseTime),
        },
      },
    ];

    let seq = 3;
    const store: AutoVersionStore = {
      findActiveProjectsWithDocuments: async () => projects,
      findLatestVersion: async (projectId) => {
        const sorted = versions
          .filter((v) => v.projectId === projectId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return sorted[0] ?? null;
      },
      createAutoVersion: async (input) => {
        const id = `ver-${seq++}`;
        versions.push({
          id,
          projectId: input.projectId,
          label: input.label,
          state: input.state,
          createdAt: new Date(baseTime + seq * 100),
          isAuto: true,
        });
        return { id };
      },
      pruneAutoVersions: async (projectId, keepCount) => {
        const autos = versions
          .filter((v) => v.projectId === projectId && v.isAuto)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const staleIds = new Set(autos.slice(keepCount).map((v) => v.id));
        if (staleIds.size === 0) return 0;
        for (let i = versions.length - 1; i >= 0; i -= 1) {
          if (staleIds.has(versions[i]!.id)) {
            versions.splice(i, 1);
          }
        }
        return staleIds.size;
      },
    };

    expect(DEFAULT_MAX_AUTO_VERSIONS).toBe(50);

    const summary = await runAutoVersionSweep(store, { maxAutoVersions: 2 });
    expect(summary).toEqual({
      checkedProjects: 3,
      createdCount: 2,
      prunedCount: 1,
    });

    const changedAutos = versions.filter((v) => v.projectId === 'proj-changed' && v.isAuto);
    expect(changedAutos).toHaveLength(2);
    expect(changedAutos.some((v) => v.id === 'ver-1')).toBe(false);
    expect(changedAutos.some((v) => v.label === 'Auto snapshot')).toBe(true);

    expect(versions.filter((v) => v.projectId === 'proj-same')).toHaveLength(1);
    expect(versions.filter((v) => v.projectId === 'proj-first')).toHaveLength(1);
  });
});

describe('worker scene export and project thumbnails', () => {
  it('renders a 400x300 Frame + shapes + image at 2x to exact 800x600 PNG and 400x225 WebP thumbnail', async () => {
    expect(projectThumbnailKey('proj-42')).toBe('projects/proj-42/project-thumb.webp');

    const imgBuf = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: { r: 34, g: 211, b: 166, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const embeddedImages = new Map<string, string>([
      ['asset-1', `data:image/png;base64,${imgBuf.toString('base64')}`],
    ]);

    const nodes: CanvasNode[] = [
      {
        id: 'frame-1',
        type: 'frame',
        pageId: DEFAULT_PAGE_ID,
        parentId: null,
        index: 'a0',
        name: 'Frame 1',
        x: 100,
        y: 80,
        width: 400,
        height: 300,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: '#FFFFFF',
        stroke: '#373D4A',
        strokeWidth: 1,
        createdBy: 'user-1',
        updatedAt: 1,
      },
      {
        id: 'rect-1',
        type: 'rect',
        pageId: DEFAULT_PAGE_ID,
        parentId: 'frame-1',
        index: 'a1',
        name: 'Hero Box',
        x: 120,
        y: 100,
        width: 120,
        height: 80,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: '#7C5CFF',
        stroke: null,
        strokeWidth: 0,
        cornerRadius: 8,
        createdBy: 'user-1',
        updatedAt: 2,
      },
      {
        id: 'img-1',
        type: 'image',
        pageId: DEFAULT_PAGE_ID,
        parentId: 'frame-1',
        index: 'a2',
        name: 'Badge',
        x: 300,
        y: 120,
        width: 80,
        height: 80,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fill: null,
        stroke: null,
        strokeWidth: 0,
        assetId: 'asset-1',
        createdBy: 'user-1',
        updatedAt: 3,
      },
    ];

    const exported = await renderScenePngBuffer({
      nodes,
      scale: 2,
      nodeIds: ['frame-1'],
      embeddedImages,
    });
    expect(exported.width).toBe(800);
    expect(exported.height).toBe(600);

    const pngMeta = await sharp(exported.buffer).metadata();
    expect(pngMeta.format).toBe('png');
    expect(pngMeta.width).toBe(800);
    expect(pngMeta.height).toBe(600);

    const thumb = await renderSceneThumbnailWebp({
      nodes,
      embeddedImages,
    });
    const thumbMeta = await sharp(thumb).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(400);
    expect(thumbMeta.height).toBe(225);
  });

  it('parses worker runtime config with defaults and explicit overrides', async () => {
    const { getWorkerConfig } = await import('./config.js');
    const cfg = getWorkerConfig({
      databaseUrl: 'postgresql://user:pass@db:5432/nova',
      redisUrl: 'redis://redis:6379',
      s3Bucket: 'custom-bucket',
      s3ForcePathStyle: false,
      autoVersionIntervalMs: 60_000,
    });
    expect(cfg.databaseUrl).toBe('postgresql://user:pass@db:5432/nova');
    expect(cfg.redisUrl).toBe('redis://redis:6379');
    expect(cfg.s3Bucket).toBe('custom-bucket');
    expect(cfg.s3ForcePathStyle).toBe(false);
    expect(cfg.autoVersionIntervalMs).toBe(60_000);
    expect(cfg.maxAutoVersions).toBe(50);
  });
});
