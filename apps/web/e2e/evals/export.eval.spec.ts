import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  DEFAULT_PAGE_ID,
  renderCanvasNodesToSvg,
  type CanvasNode,
} from '@nova/shared';
import {
  createMultiplayerProject,
  expect,
  test,
} from '../fixtures/multiplayer';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcPayload), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidPngBuffer(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      raw[px] = rgba[0];
      raw[px + 1] = rgba[1];
      raw[px + 2] = rgba[2];
      raw[px + 3] = rgba[3];
    }
  }

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', deflateSync(raw)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i += 1) {
    if (png[i] !== sig[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkData = png.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8] ?? 0;
      colorType = chunkData[9] ?? 0;
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const scanlineBytes = width * bpp;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const reconstructed = new Uint8Array(height * scanlineBytes);
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (scanlineBytes + 1)] ?? 0;
    const srcOffset = y * (scanlineBytes + 1) + 1;
    const dstOffset = y * scanlineBytes;

    for (let i = 0; i < scanlineBytes; i += 1) {
      const x = inflated[srcOffset + i] ?? 0;
      const a = i >= bpp ? (reconstructed[dstOffset + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (reconstructed[(y - 1) * scanlineBytes + i] ?? 0) : 0;
      const c =
        y > 0 && i >= bpp ? (reconstructed[(y - 1) * scanlineBytes + i - bpp] ?? 0) : 0;

      let recon = x;
      if (filter === 1) recon = (x + a) & 0xff;
      else if (filter === 2) recon = (x + b) & 0xff;
      else if (filter === 3) recon = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (x + paethPredictor(a, b, c)) & 0xff;

      reconstructed[dstOffset + i] = recon;
    }

    for (let col = 0; col < width; col += 1) {
      const s = dstOffset + col * bpp;
      const d = (y * width + col) * 4;
      rgba[d] = reconstructed[s] ?? 0;
      rgba[d + 1] = reconstructed[s + 1] ?? 0;
      rgba[d + 2] = reconstructed[s + 2] ?? 0;
      rgba[d + 3] = bpp === 4 ? (reconstructed[s + 3] ?? 255) : 255;
    }
  }

  return { width, height, rgba };
}

function computePixelDiffRatio(a: Uint8Array, b: Uint8Array, channelTolerance = 8): number {
  const totalPixels = Math.floor(a.length / 4);
  if (totalPixels === 0 || a.length !== b.length) return 1;
  let diffPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    const dg = Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0));
    const db = Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
    const da = Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0));
    if (Math.max(dr, dg, db, da) > channelTolerance) {
      diffPixels += 1;
    }
  }
  return diffPixels / totalPixels;
}

test.describe('Export and Thumbnail Evals (M2)', () => {
  test('E11: exporting a 400x300 Frame at 2x produces an 800x600 PNG <= 1% pixel diff vs golden and updates dashboard WebP thumbnail', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'E11-Export', ['OWNER']);
    try {
      const owner = harness.sessions[0]!;
      const page = owner.page;

      // Upload a deterministic 64x64 amber PNG sticker asset into the project
      const stickerPng = createSolidPngBuffer(64, 64, [245, 158, 11, 255]);
      const refreshRes = await owner.context.request.post('/api/v1/auth/refresh');
      expect(refreshRes.ok()).toBe(true);
      const { accessToken } = (await refreshRes.json()) as { accessToken: string };

      const uploadUrlRes = await owner.context.request.post(
        `/api/v1/projects/${harness.projectId}/assets/upload-url`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          data: {
            filename: 'e11-badge.png',
            mimeType: 'image/png',
            sizeBytes: stickerPng.byteLength,
          },
        },
      );
      expect(uploadUrlRes.ok()).toBe(true);
      const { assetId, putUrl } = (await uploadUrlRes.json()) as {
        assetId: string;
        putUrl: string;
      };

      const putRes = await owner.context.request.put(putUrl, {
        headers: { 'Content-Type': 'image/png' },
        data: stickerPng,
      });
      expect(putRes.ok()).toBe(true);

      const confirmRes = await owner.context.request.post(
        `/api/v1/assets/${assetId}/confirm`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(confirmRes.ok()).toBe(true);

      // Build a 400x300 Frame at (120, 80) with 3 shapes + 1 text + 1 image inside it
      await page.evaluate(
        ({ uploadedAssetId }) => {
          const handle = window.__NOVA_EDITOR__;
          if (!handle) throw new Error('Missing __NOVA_EDITOR__');
          const inputs = [
            {
              id: 'e11-frame',
              type: 'frame' as const,
              name: 'Export Frame',
              x: 120,
              y: 80,
              width: 400,
              height: 300,
              fill: '#FFFFFF',
              stroke: '#373D4A',
              strokeWidth: 1,
              cornerRadius: 0,
            },
            {
              id: 'e11-rect',
              type: 'rect' as const,
              parentId: 'e11-frame',
              name: 'Hero Panel',
              x: 150,
              y: 110,
              width: 140,
              height: 100,
              fill: '#7C5CFF',
              strokeWidth: 0,
              cornerRadius: 8,
            },
            {
              id: 'e11-ellipse',
              type: 'ellipse' as const,
              parentId: 'e11-frame',
              name: 'Mint Orb',
              x: 160,
              y: 230,
              width: 90,
              height: 90,
              fill: '#22D3A6',
              strokeWidth: 0,
            },
            {
              id: 'e11-line',
              type: 'line' as const,
              parentId: 'e11-frame',
              name: 'Rule Line',
              x: 310,
              y: 250,
              width: 160,
              height: 4,
              points: [0, 0, 160, 0],
              stroke: '#1A1A1E',
              strokeWidth: 4,
            },
            {
              id: 'e11-text',
              type: 'text' as const,
              parentId: 'e11-frame',
              name: 'Title',
              x: 310,
              y: 270,
              width: 150,
              height: 36,
              text: 'NOVA',
              fontFamily: 'Inter',
              fontSize: 22,
              fontWeight: 700,
              fill: '#1A1A1E',
            },
            {
              id: 'e11-image',
              type: 'image' as const,
              parentId: 'e11-frame',
              name: 'Badge Image',
              x: 330,
              y: 120,
              width: 80,
              height: 80,
              fill: null,
              strokeWidth: 0,
              assetId: uploadedAssetId,
            },
          ];
          for (const input of inputs) {
            handle.editor.commands.execute({ type: 'createNode', input });
          }
          handle.editor.selection.set(['e11-frame']);
        },
        { uploadedAssetId: assetId },
      );

      // Ensure uploaded image bitmap finished loading & painting on Konva canvas
      await page.waitForFunction(() => {
        const handle = window.__NOVA_EDITOR__;
        return Boolean(handle && handle.editor.scene.getAllNodes().length === 6);
      });
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const handle = window.__NOVA_EDITOR__;
              if (!handle?.renderer) return false;
              const dataUrl = await handle.renderer.exportDataURL({
                scale: 1,
                nodeIds: ['e11-image'],
                padding: 0,
              });
              const img = new Image();
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Image preview load failed'));
                img.src = dataUrl;
              });
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return false;
              ctx.drawImage(img, 0, 0);
              const px = ctx.getImageData(
                Math.floor(img.width / 2),
                Math.floor(img.height / 2),
                1,
                1,
              ).data;
              return (px[0] ?? 0) > 200 && (px[1] ?? 0) > 120 && (px[2] ?? 0) < 40;
            }),
          { timeout: 10_000 },
        )
        .toBe(true);

      // Export 2x Frame PNG via TopBar Export Popover -> Client Konva PNG
      await page.getByTestId('export-options-btn').click();
      await expect(page.getByTestId('export-popover')).toBeVisible();
      await page.getByTestId('export-scale-select').selectOption('2');
      await page.getByTestId('export-scope-select').selectOption('selection');

      const [clientDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-client-btn').click(),
      ]);
      const clientDownloadPath = await clientDownload.path();
      expect(clientDownloadPath).toBeTruthy();
      const clientPngBytes = await fs.readFile(clientDownloadPath!);

      // Also verify Server 2x Export via UI button produces exact 800x600 PNG
      await page.getByTestId('export-options-btn').click();
      await page.getByTestId('export-scale-select').selectOption('2');
      await page.getByTestId('export-scope-select').selectOption('selection');

      const [serverDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('export-server-btn').click(),
      ]);
      const serverDownloadPath = await serverDownload.path();
      expect(serverDownloadPath).toBeTruthy();
      const serverPngBytes = await fs.readFile(serverDownloadPath!);

      // Compare client 2x PNG vs server 2x PNG and deterministic SVG golden render
      const clientDecoded = decodePngRgba(clientPngBytes);
      const serverDecoded = decodePngRgba(serverPngBytes);

      expect(clientDecoded.width).toBe(800);
      expect(clientDecoded.height).toBe(600);
      expect(serverDecoded.width).toBe(800);
      expect(serverDecoded.height).toBe(600);

      const sceneNodes = await page.evaluate(() => window.__nova?.scene() ?? []) as CanvasNode[];
      const embeddedImages = new Map<string, string>([
        [assetId, `data:image/png;base64,${stickerPng.toString('base64')}`],
      ]);
      const goldenSvg = renderCanvasNodesToSvg(sceneNodes, {
        pageId: DEFAULT_PAGE_ID,
        scale: 2,
        nodeIds: ['e11-frame'],
        embeddedImages,
      });
      expect(goldenSvg.width).toBe(800);
      expect(goldenSvg.height).toBe(600);

      // Render deterministic golden SVG inside Chromium 2D canvas to compare 1:1 against client Konva export
      const goldenPngBase64 = await page.evaluate(
        async ({ svgMarkup, w, h }) => {
          const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load golden SVG'));
              img.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('2D context unavailable');
            ctx.drawImage(img, 0, 0, w, h);
            return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        { svgMarkup: goldenSvg.svg, w: 800, h: 600 },
      );

      const goldenDecoded = decodePngRgba(Buffer.from(goldenPngBase64, 'base64'));
      expect(goldenDecoded.width).toBe(800);
      expect(goldenDecoded.height).toBe(600);

      const clientVsGoldenDiff = computePixelDiffRatio(clientDecoded.rgba, goldenDecoded.rgba);
      const serverVsGoldenDiff = computePixelDiffRatio(serverDecoded.rgba, goldenDecoded.rgba);
      expect(clientVsGoldenDiff).toBeLessThanOrEqual(0.01);
      expect(serverVsGoldenDiff).toBeLessThanOrEqual(0.01);

      const screenshotDir = path.resolve(process.cwd(), '../../harness/evals/screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'E11.png') });

      // Navigate back to /dashboard and verify authenticated project thumbnail displays
      await page.goto('/dashboard');
      await expect(page.getByTestId(`project-thumb-${harness.projectId}`)).toBeVisible({
        timeout: 15_000,
      });

      const thumbLoaded = await page
        .getByTestId(`project-thumb-${harness.projectId}`)
        .evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
      expect(thumbLoaded).toBe(true);
    } finally {
      await harness.closeAll();
    }
  });
});
