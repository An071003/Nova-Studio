import { Editor } from '@nova/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EDITOR_KONVA_VERSION, KonvaRenderer } from './index.js';

function installCanvas2DMock(): void {
  const noop = () => undefined;
  const fakeContext: Record<string, unknown> = {
    canvas: null,
    save: noop,
    restore: noop,
    scale: noop,
    rotate: noop,
    translate: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    drawImage: noop,
    setLineDash: noop,
    getLineDash: () => [],
    measureText: (text: string) => ({ width: text.length * 8 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData: noop,
  };

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement) {
      return { ...fakeContext, canvas: this };
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value() {
      // Minimal 1x1 transparent PNG base64
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    },
  });
}

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe('@nova/editor-konva', () => {
  beforeAll(() => {
    installCanvas2DMock();
  });

  it('exposes editor-konva version', () => {
    expect(EDITOR_KONVA_VERSION).toBe(1);
  });

  it('mounts KonvaRenderer, renders all node types, handles viewport & exportPNG', async () => {
    const doc = new Y.Doc();
    const editor = new Editor({ doc, userId: 'u-1', userName: 'Alex' });
    const container = makeContainer();
    const renderer = new KonvaRenderer(editor);
    renderer.mount(container);

    editor.commands.execute({
      type: 'createNode',
      input: { type: 'frame', x: 50, y: 50, width: 400, height: 300 },
    });
    editor.commands.execute({
      type: 'createNode',
      input: { type: 'rect', x: 80, y: 80, width: 120, height: 90, fill: '#7C5CFF' },
    });
    editor.commands.execute({
      type: 'createNode',
      input: { type: 'ellipse', x: 240, y: 100, width: 100, height: 100, fill: '#22D3EE' },
    });
    const textRes = editor.commands.execute({
      type: 'createNode',
      input: { type: 'text', x: 80, y: 200, width: 200, height: 40, text: 'Hello NOVA' },
    });
    editor.commands.execute({
      type: 'createNode',
      input: { type: 'image', x: 300, y: 200, width: 120, height: 80, assetId: 'asset-1' },
    });
    editor.commands.execute({
      type: 'createNode',
      input: { type: 'line', x: 60, y: 310, width: 150, height: 0, points: [0, 0, 150, 0] },
    });

    expect(renderer.getMountedShapeCount()).toBe(6);

    editor.selection.set(textRes.createdIds);
    editor.viewport.panBy(20, -10);
    editor.viewport.zoomAt(1.5, { x: 600, y: 400 });
    expect(editor.viewport.getState().zoom).toBeCloseTo(1.5, 5);

    const png = await renderer.exportPNG({ scale: 2 });
    expect(png.byteLength).toBeGreaterThan(20);

    renderer.destroy();
    editor.destroy();
    container.remove();
  });

  it('maintains < 16.6ms per frame over pan/zoom + incremental diff at 500 nodes', () => {
    const doc = new Y.Doc();
    const editor = new Editor({ doc, userId: 'u-bench' });
    for (let i = 0; i < 500; i += 1) {
      editor.commands.execute({
        type: 'createNode',
        input: {
          type: i % 2 === 0 ? 'rect' : 'ellipse',
          x: (i % 25) * 60,
          y: Math.floor(i / 25) * 60,
          width: 48,
          height: 48,
        },
      });
    }

    const container = makeContainer();
    const renderer = new KonvaRenderer(editor);
    renderer.mount(container);
    expect(renderer.getMountedShapeCount()).toBe(500);

    const firstId = editor.scene.getAllNodes()[0]!.id;
    const start = performance.now();
    for (let frame = 0; frame < 30; frame += 1) {
      editor.viewport.panBy(5, 3);
      editor.commands.execute({
        type: 'updateNodes',
        patches: [{ id: firstId, patch: { x: frame * 4 } }],
      });
    }
    const elapsedMs = performance.now() - start;
    const meanFrameMs = elapsedMs / 30;
    expect(meanFrameMs).toBeLessThan(16.6);

    renderer.destroy();
    editor.destroy();
    container.remove();
  });
});
