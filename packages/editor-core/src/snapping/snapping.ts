import type { CanvasNode } from '@nova/shared';
import { getNodeAABB, rectToAABB, type AABB, type Rect } from '../geometry/geometry.js';

export const SNAP_SCREEN_THRESHOLD_PX = 6;

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: SnapGuide[];
}

/**
 * Computes edge/center smart guides against nearby nodes (and optional grid step)
 * within 6 screen pixels (`6 / zoom` world units).
 */
export function computeSnap(opts: {
  movingIds: ReadonlySet<string>;
  proposedRect: Rect;
  candidates: CanvasNode[];
  zoom: number;
  gridSize?: number;
}): SnapResult {
  const { movingIds, proposedRect, candidates, zoom, gridSize } = opts;
  const threshold = SNAP_SCREEN_THRESHOLD_PX / Math.max(0.05, zoom);
  const movingBox = rectToAABB(proposedRect);

  const movingXTargets = [
    movingBox.minX,
    (movingBox.minX + movingBox.maxX) / 2,
    movingBox.maxX,
  ];
  const movingYTargets = [
    movingBox.minY,
    (movingBox.minY + movingBox.maxY) / 2,
    movingBox.maxY,
  ];

  let bestDx = 0;
  let bestDistX = threshold;
  let bestTargetX: number | null = null;
  let bestBoxesX: AABB[] = [];

  let bestDy = 0;
  let bestDistY = threshold;
  let bestTargetY: number | null = null;
  let bestBoxesY: AABB[] = [];

  for (const candidate of candidates) {
    if (!candidate.visible || movingIds.has(candidate.id)) {
      continue;
    }
    const box = getNodeAABB(candidate);
    const candXs = [box.minX, (box.minX + box.maxX) / 2, box.maxX];
    const candYs = [box.minY, (box.minY + box.maxY) / 2, box.maxY];

    for (const mx of movingXTargets) {
      for (const cx of candXs) {
        const delta = cx - mx;
        const absDelta = Math.abs(delta);
        if (absDelta < bestDistX - 1e-6) {
          bestDistX = absDelta;
          bestDx = delta;
          bestTargetX = cx;
          bestBoxesX = [box];
        } else if (bestTargetX !== null && Math.abs(cx - bestTargetX) < 1e-3 && absDelta <= bestDistX) {
          bestBoxesX.push(box);
        }
      }
    }

    for (const my of movingYTargets) {
      for (const cy of candYs) {
        const delta = cy - my;
        const absDelta = Math.abs(delta);
        if (absDelta < bestDistY - 1e-6) {
          bestDistY = absDelta;
          bestDy = delta;
          bestTargetY = cy;
          bestBoxesY = [box];
        } else if (bestTargetY !== null && Math.abs(cy - bestTargetY) < 1e-3 && absDelta <= bestDistY) {
          bestBoxesY.push(box);
        }
      }
    }
  }

  let snappedX = bestTargetX !== null;
  let snappedY = bestTargetY !== null;

  if (!snappedX && gridSize && gridSize > 0) {
    const snappedLeft = Math.round(movingBox.minX / gridSize) * gridSize;
    const gridDelta = snappedLeft - movingBox.minX;
    if (Math.abs(gridDelta) < bestDistX) {
      bestDx = gridDelta;
      snappedX = true;
    }
  }

  if (!snappedY && gridSize && gridSize > 0) {
    const snappedTop = Math.round(movingBox.minY / gridSize) * gridSize;
    const gridDelta = snappedTop - movingBox.minY;
    if (Math.abs(gridDelta) < bestDistY) {
      bestDy = gridDelta;
      snappedY = true;
    }
  }

  const guides: SnapGuide[] = [];
  if (bestTargetX !== null) {
    let start = movingBox.minY + bestDy;
    let end = movingBox.maxY + bestDy;
    for (const b of bestBoxesX) {
      start = Math.min(start, b.minY);
      end = Math.max(end, b.maxY);
    }
    guides.push({ orientation: 'vertical', position: bestTargetX, start, end });
  }

  if (bestTargetY !== null) {
    let start = movingBox.minX + bestDx;
    let end = movingBox.maxX + bestDx;
    for (const b of bestBoxesY) {
      start = Math.min(start, b.minX);
      end = Math.max(end, b.maxX);
    }
    guides.push({ orientation: 'horizontal', position: bestTargetY, start, end });
  }

  return { dx: bestDx, dy: bestDy, snappedX, snappedY, guides };
}
