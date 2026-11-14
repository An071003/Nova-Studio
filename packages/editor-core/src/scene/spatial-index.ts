import type { CanvasNode, Point } from '@nova/shared';
import RBush from 'rbush';
import {
  getNodeAABB,
  pointInNode,
  rectToAABB,
  type AABB,
  type Rect,
} from '../geometry/geometry.js';
import type { SceneDiff, SceneGraph } from './scene-graph.js';

export interface SpatialItem extends AABB {
  id: string;
}

/**
 * R-tree (`rbush`) spatial index synced incrementally from `SceneDiff` for fast hit-test
 * and viewport culling across 1,000+ nodes.
 */
export class SpatialIndex {
  private readonly tree = new RBush<SpatialItem>();
  private readonly itemsById = new Map<string, SpatialItem>();

  rebuild(nodes: CanvasNode[]): void {
    this.tree.clear();
    this.itemsById.clear();
    const batch: SpatialItem[] = [];
    for (const node of nodes) {
      if (!node.visible) {
        continue;
      }
      const item: SpatialItem = { id: node.id, ...getNodeAABB(node) };
      this.itemsById.set(node.id, item);
      batch.push(item);
    }
    if (batch.length > 0) {
      this.tree.load(batch);
    }
  }

  applyDiff(diff: SceneDiff): void {
    for (const removedId of diff.removed) {
      const prev = this.itemsById.get(removedId);
      if (prev) {
        this.tree.remove(prev);
        this.itemsById.delete(removedId);
      }
    }

    for (const { node } of diff.updated) {
      const prev = this.itemsById.get(node.id);
      if (prev) {
        this.tree.remove(prev);
        this.itemsById.delete(node.id);
      }
      if (node.visible) {
        const next: SpatialItem = { id: node.id, ...getNodeAABB(node) };
        this.itemsById.set(node.id, next);
        this.tree.insert(next);
      }
    }

    for (const node of diff.added) {
      if (node.visible) {
        const next: SpatialItem = { id: node.id, ...getNodeAABB(node) };
        this.itemsById.set(node.id, next);
        this.tree.insert(next);
      }
    }
  }

  /** Queries candidate IDs overlapping `rect` in world coordinates. */
  searchRect(rect: Rect): string[] {
    const aabb = rectToAABB(rect);
    return this.tree.search(aabb).map((item) => item.id);
  }

  /**
   * Returns the topmost visible (and optionally unlocked, non-group) node under `worldPt`,
   * ordered by `SceneGraph` paint order.
   */
  hitTestPoint(
    worldPt: Point,
    scene: SceneGraph,
    opts?: { pageId?: string; tolerance?: number; includeLocked?: boolean; includeGroups?: boolean },
  ): CanvasNode | null {
    const tol = opts?.tolerance ?? 4;
    const hits = this.tree.search({
      minX: worldPt.x - tol,
      minY: worldPt.y - tol,
      maxX: worldPt.x + tol,
      maxY: worldPt.y + tol,
    });
    if (hits.length === 0) {
      return null;
    }

    const hitIdSet = new Set(hits.map((h) => h.id));
    const ordered = scene.getAllNodes(opts?.pageId);
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const node = ordered[i]!;
      if (!hitIdSet.has(node.id)) {
        continue;
      }
      if (!opts?.includeLocked && node.locked) {
        continue;
      }
      if (!opts?.includeGroups && node.type === 'group') {
        continue;
      }
      if (pointInNode(worldPt, node, tol)) {
        return node;
      }
    }
    return null;
  }

  clear(): void {
    this.tree.clear();
    this.itemsById.clear();
  }
}
