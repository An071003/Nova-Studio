import { DEFAULT_PAGE_ID, type CanvasNode } from '../doc/node.js';

export interface ExportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ExportSelectionResult {
  nodes: CanvasNode[];
  allowedIds: Set<string> | null;
  bounds: ExportBounds | null;
  padding: number;
}

export function expandSelectedSubtreeIds(
  allNodes: readonly CanvasNode[],
  rootIds: readonly string[],
): Set<string> {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string, string[]>();
  for (const n of allNodes) {
    if (n.parentId !== null) {
      const list = childrenByParent.get(n.parentId);
      if (list) {
        list.push(n.id);
      } else {
        childrenByParent.set(n.parentId, [n.id]);
      }
    }
  }

  const collected = new Set<string>();
  const stack: string[] = [];
  for (const id of rootIds) {
    if (byId.has(id) && !collected.has(id)) {
      collected.add(id);
      stack.push(id);
    }
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const children = childrenByParent.get(cur);
    if (children) {
      for (const childId of children) {
        if (!collected.has(childId)) {
          collected.add(childId);
          stack.push(childId);
        }
      }
    }
  }
  return collected;
}

function getNodeBounds(node: CanvasNode): ExportBounds {
  const w = Math.max(0, node.width);
  const h = Math.max(0, node.height);
  if (node.type === 'line' && node.points && node.points.length >= 4) {
    let minX = node.x;
    let maxX = node.x;
    let minY = node.y;
    let maxY = node.y;
    for (let i = 0; i < node.points.length; i += 2) {
      const px = node.x + (node.points[i] ?? 0);
      const py = node.y + (node.points[i + 1] ?? 0);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    return { minX, minY, maxX: Math.max(minX + 1, maxX), maxY: Math.max(minY + 1, maxY) };
  }
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + w,
    maxY: node.y + h,
  };
}

function mergeExportBounds(boxes: readonly ExportBounds[]): ExportBounds | null {
  if (boxes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const b of boxes) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** Resolves visible nodes, subtree expansion, and pixel-exact bounds for exports. */
export function collectExportTargets(
  allNodes: readonly CanvasNode[],
  opts?: {
    nodeIds?: readonly string[];
    pageId?: string;
    padding?: number;
  },
): ExportSelectionResult {
  const pageId = opts?.pageId ?? DEFAULT_PAGE_ID;
  const pageNodes = allNodes.filter((n) => n.pageId === pageId);

  const requestedIds = opts?.nodeIds && opts.nodeIds.length > 0 ? opts.nodeIds : null;
  const allowedIds = requestedIds ? expandSelectedSubtreeIds(pageNodes, requestedIds) : null;

  const visibleNodes = pageNodes.filter(
    (n) => n.visible && (allowedIds === null || allowedIds.has(n.id)),
  );

  // If exporting a single explicitly selected Frame (with its descendants), frame dimensions are exact (padding = 0)
  let singleFrameRoot: CanvasNode | null = null;
  if (requestedIds) {
    const requestedNodes = requestedIds
      .map((id) => visibleNodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n));
    const rootRequested = requestedNodes.filter(
      (n) => !n.parentId || !requestedIds.includes(n.parentId),
    );
    if (rootRequested.length === 1 && rootRequested[0]?.type === 'frame') {
      singleFrameRoot = rootRequested[0];
    }
  } else {
    const topLevelVisible = visibleNodes.filter((n) => n.parentId === null);
    if (topLevelVisible.length === 1 && topLevelVisible[0]?.type === 'frame') {
      singleFrameRoot = topLevelVisible[0];
    }
  }

  if (singleFrameRoot) {
    return {
      nodes: visibleNodes,
      allowedIds,
      bounds: getNodeBounds(singleFrameRoot),
      padding: opts?.padding ?? 0,
    };
  }

  return {
    nodes: visibleNodes,
    allowedIds,
    bounds: mergeExportBounds(visibleNodes.map(getNodeBounds)),
    padding: opts?.padding ?? 16,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAttr(value: string): string {
  return escapeXml(value);
}

export interface RenderSvgOptions {
  scale?: number;
  nodeIds?: readonly string[];
  pageId?: string;
  background?: string | null;
  padding?: number;
  embeddedImages?: ReadonlyMap<string, string>;
}

export interface RenderedSvgScene {
  svg: string;
  width: number;
  height: number;
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
}

function renderNodeSvg(
  node: CanvasNode,
  embeddedImages?: ReadonlyMap<string, string>,
): string {
  const rotationAttr =
    node.rotation !== 0 ? ` transform="translate(${node.x} ${node.y}) rotate(${node.rotation})"` : ` transform="translate(${node.x} ${node.y})"`;
  const opacityAttr = node.opacity !== 1 ? ` opacity="${node.opacity}"` : '';

  if (node.type === 'group') {
    return '';
  }

  if (node.type === 'rect') {
    const w = Math.max(0, node.width);
    const h = Math.max(0, node.height);
    const rx = node.cornerRadius ?? 0;
    const fill = node.fill ? escapeAttr(node.fill) : 'none';
    const stroke = node.stroke && node.strokeWidth > 0 ? escapeAttr(node.stroke) : 'none';
    const sw = node.stroke && node.strokeWidth > 0 ? node.strokeWidth : 0;
    return `<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacityAttr}${rotationAttr} />`;
  }

  if (node.type === 'frame') {
    const w = Math.max(1, node.width);
    const h = Math.max(1, node.height);
    const rx = node.cornerRadius ?? 2;
    const fill = node.fill !== null ? escapeAttr(node.fill) : '#FFFFFF';
    const stroke = escapeAttr(node.stroke ?? '#373D4A');
    const sw = node.strokeWidth > 0 ? node.strokeWidth : 1;
    return `<rect x="0" y="0" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacityAttr}${rotationAttr} />`;
  }

  if (node.type === 'ellipse') {
    const w = Math.max(1, node.width);
    const h = Math.max(1, node.height);
    const cx = w / 2;
    const cy = h / 2;
    const fill = node.fill ? escapeAttr(node.fill) : 'none';
    const stroke = node.stroke && node.strokeWidth > 0 ? escapeAttr(node.stroke) : 'none';
    const sw = node.stroke && node.strokeWidth > 0 ? node.strokeWidth : 0;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacityAttr}${rotationAttr} />`;
  }

  if (node.type === 'line') {
    const pts = node.points ?? [0, 0, node.width, node.height];
    const x1 = pts[0] ?? 0;
    const y1 = pts[1] ?? 0;
    const x2 = pts[2] ?? node.width;
    const y2 = pts[3] ?? node.height;
    const stroke = escapeAttr(node.stroke ?? node.fill ?? '#E8EAF0');
    const sw = Math.max(2, node.strokeWidth || 2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}${rotationAttr} />`;
  }

  if (node.type === 'text') {
    const text = node.text ?? 'Text';
    const fontSize = node.fontSize ?? 18;
    const lineHeight = node.lineHeight ?? 1.25;
    const rawWeight = node.fontWeight;
    const fontWeight =
      typeof rawWeight === 'number'
        ? String(rawWeight)
        : rawWeight === 'italic'
          ? '400'
          : rawWeight ?? '400';
    const fontStyle = rawWeight === 'italic' ? 'italic' : 'normal';
    const rawFamily = node.fontFamily ?? 'Inter';
    const fontFamily = escapeAttr(
      rawFamily.includes(',') ? rawFamily : `${rawFamily}, sans-serif`,
    );
    const fill = escapeAttr(node.fill ?? '#E8EAF0');
    const align = node.align ?? 'left';
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const textX =
      align === 'center' ? node.width / 2 : align === 'right' ? node.width : 0;
    const lines = text.split('\n');
    const lineAdvance = fontSize * lineHeight;
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${textX}" y="${fontSize * 0.85 + i * lineAdvance}">${escapeXml(line)}</tspan>`,
      )
      .join('');
    return `<text font-family="${fontFamily}" font-size="${fontSize}" font-weight="${escapeAttr(fontWeight)}" font-style="${fontStyle}" text-anchor="${anchor}" fill="${fill}"${opacityAttr}${rotationAttr}>${tspans}</text>`;
  }

  if (node.type === 'image') {
    const w = Math.max(1, node.width);
    const h = Math.max(1, node.height);
    const dataUri = node.assetId ? embeddedImages?.get(node.assetId) : undefined;
    if (dataUri) {
      const safeUri = escapeAttr(dataUri);
      return `<image x="0" y="0" width="${w}" height="${h}" href="${safeUri}" preserveAspectRatio="none"${opacityAttr}${rotationAttr} />`;
    }
    const fill = escapeAttr(node.fill ?? '#262A33');
    const stroke = escapeAttr(node.stroke ?? '#373D4A');
    const sw = Math.max(1, node.strokeWidth);
    return `<rect x="0" y="0" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacityAttr}${rotationAttr} />`;
  }

  return '';
}

/** Generates deterministic SVG matching Konva scene layout for server-side Sharp PNG & thumbnail export. */
export function renderCanvasNodesToSvg(
  allNodes: readonly CanvasNode[],
  opts: RenderSvgOptions = {},
): RenderedSvgScene {
  const scale = Math.max(0.25, opts.scale ?? 1);
  const selection = collectExportTargets(allNodes, {
    nodeIds: opts.nodeIds,
    pageId: opts.pageId,
    padding: opts.padding,
  });

  const bounds = selection.bounds ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const padding = selection.bounds ? selection.padding : 0;
  const worldX = bounds.minX - padding;
  const worldY = bounds.minY - padding;
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const width = Math.max(1, Math.round(worldWidth * scale));
  const height = Math.max(1, Math.round(worldHeight * scale));

  const bgLayer = opts.background
    ? `<rect x="${worldX}" y="${worldY}" width="${worldWidth}" height="${worldHeight}" fill="${escapeAttr(opts.background)}" />`
    : '';
  const body = selection.nodes
    .map((node) => renderNodeSvg(node, opts.embeddedImages))
    .filter(Boolean)
    .join('\n  ');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${worldX} ${worldY} ${worldWidth} ${worldHeight}">`,
    bgLayer ? `  ${bgLayer}` : '',
    body ? `  ${body}` : '',
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');

  return { svg, width, height, worldX, worldY, worldWidth, worldHeight };
}
