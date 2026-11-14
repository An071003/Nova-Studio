import type { CanvasNode, Point, ViewportState } from '@nova/shared';
import { getNodeAABB, mergeAABBs } from '../geometry/geometry.js';

export type ViewportListener = (viewport: ViewportState) => void;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Manages camera pan (`x`, `y`) and zoom, plus screen <-> world coordinate transforms. */
export class ViewportStore {
  private state: ViewportState;
  private readonly listeners = new Set<ViewportListener>();

  constructor(initial?: Partial<ViewportState>) {
    this.state = {
      x: initial?.x ?? 0,
      y: initial?.y ?? 0,
      zoom: clampZoom(initial?.zoom ?? 1),
    };
  }

  getState(): ViewportState {
    return { ...this.state };
  }

  setState(next: Partial<ViewportState>): void {
    const updated: ViewportState = {
      x: next.x ?? this.state.x,
      y: next.y ?? this.state.y,
      zoom: clampZoom(next.zoom ?? this.state.zoom),
    };
    if (
      updated.x === this.state.x &&
      updated.y === this.state.y &&
      updated.zoom === this.state.zoom
    ) {
      return;
    }
    this.state = updated;
    this.emit();
  }

  screenToWorld(screenPt: Point): Point {
    return {
      x: (screenPt.x - this.state.x) / this.state.zoom,
      y: (screenPt.y - this.state.y) / this.state.zoom,
    };
  }

  worldToScreen(worldPt: Point): Point {
    return {
      x: worldPt.x * this.state.zoom + this.state.x,
      y: worldPt.y * this.state.zoom + this.state.y,
    };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.setState({
      x: this.state.x + dxScreen,
      y: this.state.y + dyScreen,
    });
  }

  /** Zooms around `screenAnchor` so the world point beneath the cursor remains stationary. */
  zoomAt(nextZoom: number, screenAnchor: Point): void {
    const clamped = clampZoom(nextZoom);
    const worldBefore = this.screenToWorld(screenAnchor);
    this.setState({
      zoom: clamped,
      x: screenAnchor.x - worldBefore.x * clamped,
      y: screenAnchor.y - worldBefore.y * clamped,
    });
  }

  zoomTo100(): void {
    this.setState({ zoom: 1 });
  }

  fitToNodes(
    nodes: CanvasNode[],
    viewportSize: { width: number; height: number },
    padding = 48,
  ): void {
    const visibleNodes = nodes.filter((n) => n.visible);
    if (visibleNodes.length === 0 || viewportSize.width <= 0 || viewportSize.height <= 0) {
      this.setState({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const merged = mergeAABBs(visibleNodes.map((n) => getNodeAABB(n)));
    if (!merged) {
      return;
    }

    const boxW = Math.max(1, merged.maxX - merged.minX);
    const boxH = Math.max(1, merged.maxY - merged.minY);
    const availW = Math.max(1, viewportSize.width - padding * 2);
    const availH = Math.max(1, viewportSize.height - padding * 2);
    const zoom = clampZoom(Math.min(availW / boxW, availH / boxH, 2));

    const centerX = (merged.minX + merged.maxX) / 2;
    const centerY = (merged.minY + merged.maxY) / 2;
    this.setState({
      zoom,
      x: viewportSize.width / 2 - centerX * zoom,
      y: viewportSize.height / 2 - centerY * zoom,
    });
  }

  subscribe(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private emit(): void {
    const snap = this.getState();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }
}
