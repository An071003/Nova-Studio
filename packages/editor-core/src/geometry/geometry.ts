import type { CanvasNode, Point } from '@nova/shared';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Rotates `pt` around `origin` by `angleDeg` clockwise (canvas Y-down coordinates). */
export function rotatePointAround(pt: Point, origin: Point, angleDeg: number): Point {
  if (angleDeg === 0) {
    return pt;
  }
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/** Converts `Rect` (`{x,y,width,height}`) to `AABB` (`{minX,minY,maxX,maxY}`). */
export function rectToAABB(rect: Rect): AABB {
  const minX = Math.min(rect.x, rect.x + rect.width);
  const maxX = Math.max(rect.x, rect.x + rect.width);
  const minY = Math.min(rect.y, rect.y + rect.height);
  const maxY = Math.max(rect.y, rect.y + rect.height);
  return { minX, minY, maxX, maxY };
}

/** Converts `AABB` back into normalized `Rect`. */
export function aabbToRect(box: AABB): Rect {
  return {
    x: box.minX,
    y: box.minY,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
  };
}

/** Computes axis-aligned world bounding box for any node, including rotated shapes & lines. */
export function getNodeAABB(node: CanvasNode): AABB {
  if (node.type === 'line' && node.points && node.points.length >= 2) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const origin = { x: node.x, y: node.y };
    for (let i = 0; i < node.points.length - 1; i += 2) {
      const worldPt = rotatePointAround(
        { x: node.x + node.points[i]!, y: node.y + node.points[i + 1]! },
        origin,
        node.rotation,
      );
      minX = Math.min(minX, worldPt.x);
      minY = Math.min(minY, worldPt.y);
      maxX = Math.max(maxX, worldPt.x);
      maxY = Math.max(maxY, worldPt.y);
    }
    const pad = Math.max(2, node.strokeWidth / 2);
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  if (node.rotation === 0) {
    return {
      minX: node.x,
      minY: node.y,
      maxX: node.x + node.width,
      maxY: node.y + node.height,
    };
  }

  const origin = { x: node.x, y: node.y };
  const corners: Point[] = [
    origin,
    rotatePointAround({ x: node.x + node.width, y: node.y }, origin, node.rotation),
    rotatePointAround({ x: node.x + node.width, y: node.y + node.height }, origin, node.rotation),
    rotatePointAround({ x: node.x, y: node.y + node.height }, origin, node.rotation),
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from point `p` to segment `(a, b)`. */
function distPointToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Exact geometric hit-test for a world point against a node (accounting for rotation/ellipse/line). */
export function pointInNode(pt: Point, node: CanvasNode, tolerance = 4): boolean {
  if (!node.visible) {
    return false;
  }

  const local =
    node.rotation === 0
      ? { x: pt.x - node.x, y: pt.y - node.y }
      : (() => {
          const unrotated = rotatePointAround(pt, { x: node.x, y: node.y }, -node.rotation);
          return { x: unrotated.x - node.x, y: unrotated.y - node.y };
        })();

  if (node.type === 'line') {
    const pts = node.points ?? [0, 0, node.width, node.height];
    const hitDist = Math.max(tolerance, node.strokeWidth / 2 + 2);
    for (let i = 0; i < pts.length - 3; i += 2) {
      const a = { x: pts[i]!, y: pts[i + 1]! };
      const b = { x: pts[i + 2]!, y: pts[i + 3]! };
      if (distPointToSegment(local, a, b) <= hitDist) {
        return true;
      }
    }
    return false;
  }

  if (node.type === 'ellipse') {
    if (node.width <= 0 || node.height <= 0) {
      return false;
    }
    const rx = node.width / 2;
    const ry = node.height / 2;
    const nx = (local.x - rx) / rx;
    const ny = (local.y - ry) / ry;
    return nx * nx + ny * ny <= 1;
  }

  return local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height;
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function mergeAABBs(boxes: AABB[]): AABB | null {
  if (boxes.length === 0) {
    return null;
  }
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

/**
 * Computes resized bounds from a handle drag, supporting optional Shift aspect-ratio lock
 * and minimum dimension clamping without flipping axes negative.
 */
export function computeResizedBounds(opts: {
  initial: Rect;
  handle: ResizeHandle;
  dx: number;
  dy: number;
  preserveAspect?: boolean;
  minSize?: number;
}): Rect {
  const { initial, handle, dx, dy, preserveAspect = false, minSize = 4 } = opts;
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  const movesWest = handle.includes('w');
  const movesEast = handle.includes('e');
  const movesNorth = handle.includes('n');
  const movesSouth = handle.includes('s');

  if (movesWest) left = Math.min(right - minSize, left + dx);
  if (movesEast) right = Math.max(left + minSize, right + dx);
  if (movesNorth) top = Math.min(bottom - minSize, top + dy);
  if (movesSouth) bottom = Math.max(top + minSize, bottom + dy);

  let width = right - left;
  let height = bottom - top;

  if (preserveAspect && initial.width > 0 && initial.height > 0) {
    const aspect = initial.width / initial.height;
    const isCorner = (movesWest || movesEast) && (movesNorth || movesSouth);
    if (isCorner || movesWest || movesEast) {
      const targetHeight = Math.max(minSize, width / aspect);
      if (movesNorth) {
        top = bottom - targetHeight;
      } else {
        bottom = top + targetHeight;
      }
      height = bottom - top;
      width = Math.max(minSize, height * aspect);
      if (movesWest) {
        left = right - width;
      }
    } else {
      const targetWidth = Math.max(minSize, height * aspect);
      width = targetWidth;
      right = left + width;
    }
  }

  return { x: left, y: top, width, height };
}

/** Computes clockwise angle in `[0, 360)` from `center` to `pointer`, with optional snap step. */
export function computeRotationAngle(
  center: Point,
  pointer: Point,
  snapStepDeg?: number,
): number {
  let deg = Math.atan2(pointer.y - center.y, pointer.x - center.x) * RAD_TO_DEG + 90;
  deg = ((deg % 360) + 360) % 360;
  if (snapStepDeg && snapStepDeg > 0) {
    deg = Math.round(deg / snapStepDeg) * snapStepDeg;
    deg = ((deg % 360) + 360) % 360;
  }
  return deg;
}
