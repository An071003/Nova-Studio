import { DEFAULT_PAGE_ID, type CanvasNode } from '@nova/shared';
import * as Y from 'yjs';
import {
  compareNodesByIndex,
  getDocRoots,
  readNodeFromMap,
  type PageModel,
} from '../model/doc.js';

export interface SceneNodeUpdatedDiff {
  node: CanvasNode;
  changedKeys: string[];
}

export interface SceneDiff {
  added: CanvasNode[];
  updated: SceneNodeUpdatedDiff[];
  removed: string[];
  orderChanged: boolean;
}

export type SceneDiffListener = (
  diff: SceneDiff,
  meta: { origin: unknown; removedNodes: CanvasNode[] },
) => void;

/**
 * Incremental headless read-model over the Yjs `nodes` and `pages` maps.
 * Observes `nodes.observeDeep` to emit compact `SceneDiff` patches without rebuilding
 * untouched render nodes.
 */
export class SceneGraph {
  private readonly byId = new Map<string, CanvasNode>();
  private ordered: CanvasNode[] = [];
  private readonly listeners = new Set<SceneDiffListener>();
  private readonly deepObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => void;
  private readonly nodesMap: Y.Map<Y.Map<unknown>>;
  private readonly pagesMap: Y.Map<Y.Map<unknown>>;

  constructor(private readonly doc: Y.Doc) {
    const roots = getDocRoots(doc);
    this.nodesMap = roots.nodes;
    this.pagesMap = roots.pages;

    // Seed initial cache
    this.nodesMap.forEach((nodeMap, id) => {
      const parsed = readNodeFromMap(nodeMap);
      if (parsed) {
        this.byId.set(id, parsed);
      }
    });
    this.rebuildOrdered();

    this.deepObserver = (events, tr) => {
      const touched = new Map<string, Set<string>>();

      for (const event of events) {
        if (event.path.length === 0 && event instanceof Y.YMapEvent) {
          event.keys.forEach((_change, key) => {
            if (!touched.has(key)) {
              touched.set(key, new Set<string>());
            }
          });
        } else if (event.path.length >= 1) {
          const nodeId = String(event.path[0]);
          let keys = touched.get(nodeId);
          if (!keys) {
            keys = new Set<string>();
            touched.set(nodeId, keys);
          }
          if (event.path.length === 1 && event instanceof Y.YMapEvent) {
            event.keys.forEach((_change, fieldKey) => {
              keys.add(fieldKey);
            });
          } else if (event.path.length >= 2) {
            keys.add(String(event.path[1]));
          }
        }
      }

      if (touched.size === 0) {
        return;
      }

      const added: CanvasNode[] = [];
      const updated: SceneNodeUpdatedDiff[] = [];
      const removed: string[] = [];
      const removedNodes: CanvasNode[] = [];
      let orderChanged = false;

      for (const [nodeId, changedKeySet] of touched) {
        const nodeMap = this.nodesMap.get(nodeId);
        const parsed = nodeMap ? readNodeFromMap(nodeMap) : null;
        const prev = this.byId.get(nodeId);

        if (!parsed) {
          if (prev) {
            this.byId.delete(nodeId);
            removed.push(nodeId);
            removedNodes.push(prev);
            orderChanged = true;
          }
          continue;
        }

        if (!prev) {
          this.byId.set(nodeId, parsed);
          added.push(parsed);
          orderChanged = true;
        } else {
          this.byId.set(nodeId, parsed);
          const changedKeys = Array.from(changedKeySet);
          if (
            changedKeySet.has('index') ||
            changedKeySet.has('parentId') ||
            changedKeySet.has('pageId')
          ) {
            orderChanged = true;
          }
          updated.push({ node: parsed, changedKeys });
        }
      }

      if (added.length === 0 && updated.length === 0 && removed.length === 0) {
        return;
      }

      this.rebuildOrdered();
      const diff: SceneDiff = { added, updated, removed, orderChanged };
      for (const cb of this.listeners) {
        cb(diff, { origin: tr.origin, removedNodes });
      }
    };

    this.nodesMap.observeDeep(this.deepObserver);
  }

  private rebuildOrdered(): void {
    this.ordered = Array.from(this.byId.values()).sort(compareNodesByIndex);
  }

  subscribe(listener: SceneDiffListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getNode(id: string): CanvasNode | undefined {
    return this.byId.get(id);
  }

  getAllNodes(pageId?: string): CanvasNode[] {
    if (!pageId) {
      return this.ordered;
    }
    return this.ordered.filter((n) => n.pageId === pageId);
  }

  getChildren(parentId: string | null, pageId = DEFAULT_PAGE_ID): CanvasNode[] {
    return this.ordered.filter((n) => n.parentId === parentId && n.pageId === pageId);
  }

  getPages(): PageModel[] {
    const pages: PageModel[] = [];
    this.pagesMap.forEach((pageMap, id) => {
      pages.push({
        id: String(pageMap.get('id') ?? id),
        name: String(pageMap.get('name') ?? 'Page'),
        index: String(pageMap.get('index') ?? 'a0'),
        background: String(pageMap.get('background') ?? '#1A1A1E'),
      });
    });
    pages.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    return pages;
  }

  destroy(): void {
    this.nodesMap.unobserveDeep(this.deepObserver);
    this.listeners.clear();
  }
}
