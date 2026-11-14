import type { CanvasNode } from '@nova/shared';
import Konva from 'konva';

export type AssetUrlResolver = (assetId: string) => Promise<string | null> | string | null;

export interface ImageCacheEntry {
  url: string | null;
  element: HTMLImageElement | null;
  status: 'loading' | 'loaded' | 'error';
}

export function createShapeForNode(node: CanvasNode): Konva.Shape {
  switch (node.type) {
    case 'frame':
      return new Konva.Rect({ id: node.id, name: 'nova-frame' });
    case 'rect':
      return new Konva.Rect({ id: node.id, name: 'nova-rect' });
    case 'ellipse':
      return new Konva.Ellipse({ id: node.id, name: 'nova-ellipse', radiusX: 1, radiusY: 1 });
    case 'line':
      return new Konva.Line({ id: node.id, name: 'nova-line' });
    case 'text':
      return new Konva.Text({ id: node.id, name: 'nova-text' });
    case 'image':
      return new Konva.Image({
        id: node.id,
        name: 'nova-image',
        image: undefined,
      });
    case 'group':
      // Logical group container: invisible hit-transparent bounds in scene graph
      return new Konva.Rect({
        id: node.id,
        name: 'nova-group',
        fillEnabled: false,
        strokeEnabled: false,
        listening: false,
      });
  }
}

export function applyNodeAttrsToShape(
  shape: Konva.Shape,
  node: CanvasNode,
  opts?: {
    dragDx?: number;
    dragDy?: number;
    loadedImage?: HTMLImageElement | null;
  },
): void {
  const dx = opts?.dragDx ?? 0;
  const dy = opts?.dragDy ?? 0;
  const x = node.x + dx;
  const y = node.y + dy;

  shape.setAttrs({
    x,
    y,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    scaleX: 1,
    scaleY: 1,
    listening: node.visible && node.type !== 'group',
  });

  if (node.type === 'rect') {
    (shape as Konva.Rect).setAttrs({
      width: Math.max(0, node.width),
      height: Math.max(0, node.height),
      cornerRadius: node.cornerRadius ?? 0,
      fill: node.fill ?? undefined,
      fillEnabled: node.fill !== null,
      stroke: node.stroke ?? undefined,
      strokeWidth: node.strokeWidth ?? 0,
      strokeEnabled: Boolean(node.stroke && node.strokeWidth > 0),
    });
    return;
  }

  if (node.type === 'frame') {
    (shape as Konva.Rect).setAttrs({
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      cornerRadius: node.cornerRadius ?? 2,
      fill: node.fill ?? '#FFFFFF',
      fillEnabled: node.fill !== null,
      stroke: node.stroke ?? '#373D4A',
      strokeWidth: node.strokeWidth > 0 ? node.strokeWidth : 1,
      strokeEnabled: true,
    });
    return;
  }

  if (node.type === 'ellipse') {
    const w = Math.max(1, node.width);
    const h = Math.max(1, node.height);
    (shape as Konva.Ellipse).setAttrs({
      offsetX: -w / 2,
      offsetY: -h / 2,
      radiusX: w / 2,
      radiusY: h / 2,
      fill: node.fill ?? undefined,
      fillEnabled: node.fill !== null,
      stroke: node.stroke ?? undefined,
      strokeWidth: node.strokeWidth ?? 0,
      strokeEnabled: Boolean(node.stroke && node.strokeWidth > 0),
    });
    return;
  }

  if (node.type === 'line') {
    (shape as Konva.Line).setAttrs({
      points: node.points ?? [0, 0, node.width, node.height],
      stroke: node.stroke ?? node.fill ?? '#E8EAF0',
      strokeWidth: Math.max(2, node.strokeWidth || 2),
      hitStrokeWidth: 12,
      lineCap: 'round',
      lineJoin: 'round',
    });
    return;
  }

  if (node.type === 'text') {
    const rawWeight = node.fontWeight;
    const isBold =
      typeof rawWeight === 'number'
        ? rawWeight >= 600
        : rawWeight === 'bold' || Number(rawWeight) >= 600;
    const fontStyle = rawWeight === 'italic' ? 'italic' : isBold ? 'bold' : 'normal';
    const rawFamily = node.fontFamily ?? 'Inter';
    const fontFamily = rawFamily.includes(',') ? rawFamily : `${rawFamily}, system-ui, sans-serif`;
    (shape as Konva.Text).setAttrs({
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      text: node.text ?? 'Text',
      fontFamily,
      fontSize: node.fontSize ?? 18,
      fontStyle,
      align: node.align ?? 'left',
      lineHeight: node.lineHeight ?? 1.25,
      fill: node.fill ?? '#E8EAF0',
      stroke: node.stroke ?? undefined,
      strokeWidth: node.strokeWidth ?? 0,
    });
    return;
  }

  if (node.type === 'image') {
    const imgShape = shape as Konva.Image;
    imgShape.setAttrs({
      width: Math.max(1, node.width),
      height: Math.max(1, node.height),
      cornerRadius: node.cornerRadius ?? 0,
      image: opts?.loadedImage ?? undefined,
      fill: opts?.loadedImage ? undefined : node.fill ?? '#262A33',
      stroke: node.stroke ?? (opts?.loadedImage ? undefined : '#373D4A'),
      strokeWidth: opts?.loadedImage ? node.strokeWidth ?? 0 : Math.max(1, node.strokeWidth),
    });
    return;
  }

  if (node.type === 'group') {
    (shape as Konva.Rect).setAttrs({
      width: Math.max(0, node.width),
      height: Math.max(0, node.height),
    });
  }
}
