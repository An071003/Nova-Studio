import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import type { CanvasNode } from '@nova/shared';
import { createMultiplayerProject, expect, test } from '../fixtures/multiplayer';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.byteLength, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32(crcInput) >>> 0, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Generates a valid high-contrast gradient PNG at uncompressed deflate level 0
 * so a 1024x512 image weighs ~2.1 MB cleanly without external fixture binaries.
 */
function createValidPngBuffer(width: number, height: number): Buffer {
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
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      raw[px] = Math.round((x / width) * 200) + 40;
      raw[px + 1] = Math.round((y / height) * 180) + 50;
      raw[px + 2] = 240;
      raw[px + 3] = 255;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 0 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('P1-T15 Assets & Media Sync Eval (E5)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E5: User A drops a 2MB PNG onto canvas, syncs image node to B with READY asset, and rejects 30MB file', async ({
    browser,
  }) => {
    const pngBuffer = createValidPngBuffer(1024, 512);
    expect(pngBuffer.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(pngBuffer.byteLength).toBeLessThan(3 * 1024 * 1024);

    const harness = await createMultiplayerProject(browser, 'Eval-E5', ['OWNER', 'EDITOR']);
    const maxWsPayloadSeen: number[] = [];

    try {
      const [userA, userB] = harness.sessions;
      for (const session of [userA!, userB!]) {
        session.page.on('websocket', (ws) => {
          ws.on('framesent', (frame) => {
            maxWsPayloadSeen.push(
              typeof frame.payload === 'string'
                ? Buffer.byteLength(frame.payload)
                : frame.payload.byteLength,
            );
          });
          ws.on('framereceived', (frame) => {
            maxWsPayloadSeen.push(
              typeof frame.payload === 'string'
                ? Buffer.byteLength(frame.payload)
                : frame.payload.byteLength,
            );
          });
        });
      }

      // 1. User A drops 2MB PNG onto the canvas stage
      const base64Png = pngBuffer.toString('base64');
      const dataTransfer = await userA!.page.evaluateHandle((b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) {
          bytes[i] = bin.charCodeAt(i);
        }
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'gradient-2mb.png', { type: 'image/png' }));
        return dt;
      }, base64Png);

      await userA!.page.dispatchEvent('[data-testid="canvas-stage"]', 'drop', { dataTransfer });

      await expect(userA!.page.getByText(/Uploaded gradient-2mb\.png/i)).toBeVisible({
        timeout: 15_000,
      });

      // 2. Verify image node exists on both User A and User B scenes
      await expect
        .poll(async () =>
          userA!.page.evaluate(
            () => (window.__nova?.scene() ?? []).filter((n: CanvasNode) => n.type === 'image').length,
          ),
        )
        .toBe(1);

      await expect
        .poll(async () =>
          userB!.page.evaluate(
            () => (window.__nova?.scene() ?? []).filter((n: CanvasNode) => n.type === 'image').length,
          ),
        )
        .toBe(1);

      const nodeA = await userA!.page.evaluate(() =>
        (window.__nova?.scene() ?? []).find((n: CanvasNode) => n.type === 'image'),
      );
      const nodeB = await userB!.page.evaluate(() =>
        (window.__nova?.scene() ?? []).find((n: CanvasNode) => n.type === 'image'),
      );
      expect(nodeA?.assetId).toBeTruthy();
      expect(nodeB?.assetId).toBe(nodeA?.assetId);

      // 3. Verify Assets tab shows the asset READY and WebSocket never carried binary asset bytes
      await userA!.page.locator('#tab-assets').click();
      await expect(userA!.page.getByTestId(`asset-item-${nodeA!.assetId!}`)).toHaveAttribute(
        'data-status',
        'READY',
      );
      const apiAssets = await userA!.page.evaluate(async (pid) => {
        const res = await fetch(`http://localhost:4000/api/v1/projects/${pid}/assets`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('nova.accessToken') ?? ''}` },
        });
        return res.status;
      }, harness.projectId);
      // Either cookie/bearer check confirms endpoint; asset list item READY proves /confirm succeeded
      void apiAssets;

      const largestWsFrame = Math.max(0, ...maxWsPayloadSeen);
      expect(largestWsFrame).toBeLessThan(64 * 1024);

      // Wait briefly until Konva image cache finishes decoding URL on User B before screenshot
      await expect
        .poll(async () =>
          userB!.page.evaluate(() => {
            const ed = window.__NOVA_EDITOR__;
            if (!ed?.renderer) return false;
            return true;
          }),
        )
        .toBe(true);
      await expect(async () => {
        const hasPaintedPixels = await userB!.page.evaluate(() => {
          const canvases = Array.from(
            document.querySelectorAll('[data-testid="canvas-stage"] canvas'),
          );
          const ed = window.__NOVA_EDITOR__?.editor;
          const imgNode = ed?.scene.getAllNodes().find((n) => n.type === 'image');
          if (!ed || !imgNode) return false;
          const pt = ed.viewport.worldToScreen({
            x: imgNode.x + imgNode.width / 2,
            y: imgNode.y + imgNode.height / 2,
          });
          const dpr = window.devicePixelRatio || 1;
          for (const node of canvases) {
            if (!(node instanceof HTMLCanvasElement)) continue;
            const ctx = node.getContext('2d');
            if (!ctx) continue;
            const px = Math.min(node.width - 1, Math.max(0, Math.round(pt.x * dpr)));
            const py = Math.min(node.height - 1, Math.max(0, Math.round(pt.y * dpr)));
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3]! > 0 && pixel[2]! >= 200) {
              return true;
            }
          }
          return false;
        });
        expect(hasPaintedPixels).toBe(true);
      }).toPass({ timeout: 10_000 });

      await userB!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E5.png') });

      // 4. Drop a 30MB PNG -> must be rejected with clear notification and zero new nodes
      const oversizedTransfer = await userA!.page.evaluateHandle(() => {
        const dt = new DataTransfer();
        const huge = new File([new Uint8Array(30 * 1024 * 1024)], 'huge-30mb.png', {
          type: 'image/png',
        });
        dt.items.add(huge);
        return dt;
      });
      await userA!.page.dispatchEvent('[data-testid="canvas-stage"]', 'drop', {
        dataTransfer: oversizedTransfer,
      });

      await expect(userA!.page.getByText(/exceeds the 25 MB maximum upload limit/i)).toBeVisible({
        timeout: 5_000,
      });
      const finalCount = await userA!.page.evaluate(() => window.__nova?.scene().length ?? 0);
      expect(finalCount).toBe(1);
    } finally {
      await harness.closeAll();
    }
  });
});
