import * as Y from 'yjs';
import { getDocRoots, LOCAL_ORIGIN, RESTORE_ORIGIN } from '../model/doc.js';

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export type HistoryListener = (state: HistoryState) => void;

/**
 * Wraps `Y.UndoManager` scoped to `[nodes, pages]` with `trackedOrigins: Set([LOCAL_ORIGIN])`
 * so Undo/Redo only reverts this client's own actions and resets automatically on restore.
 */
export class HistoryManager {
  private readonly undoManager: Y.UndoManager;
  private readonly listeners = new Set<HistoryListener>();
  private readonly onStackChange: () => void;
  private readonly onAfterTransaction: (tr: Y.Transaction) => void;

  constructor(private readonly doc: Y.Doc) {
    const roots = getDocRoots(doc);
    this.undoManager = new Y.UndoManager([roots.nodes, roots.pages], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
      deleteFilter: (item: Y.Item): boolean => {
        // Prevent Y.UndoManager from deleting an active overwritten nodeMap key when a concurrent peer edit blocked redoItem
        if (
          item.parent instanceof Y.Map &&
          item.parent !== roots.nodes &&
          item.parent !== roots.pages &&
          item.parentSub !== null &&
          item.left !== null
        ) {
          const internalMap = (item.parent as unknown as { _map?: Map<string, Y.Item> })._map;
          if (internalMap?.get(item.parentSub) === item) {
            return false;
          }
        }
        return true;
      },
    });

    this.onStackChange = () => {
      this.emit();
    };
    this.onAfterTransaction = (tr: Y.Transaction) => {
      if (tr.origin === RESTORE_ORIGIN) {
        this.clear();
      }
    };

    this.undoManager.on('stack-item-added', this.onStackChange);
    this.undoManager.on('stack-item-popped', this.onStackChange);
    this.undoManager.on('stack-cleared', this.onStackChange);
    this.doc.on('afterTransaction', this.onAfterTransaction);
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  getState(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  undo(): boolean {
    if (!this.canUndo()) {
      return false;
    }
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) {
      return false;
    }
    this.undoManager.redo();
    return true;
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  clear(): void {
    this.undoManager.clear();
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.undoManager.off('stack-item-added', this.onStackChange);
    this.undoManager.off('stack-item-popped', this.onStackChange);
    this.undoManager.off('stack-cleared', this.onStackChange);
    this.doc.off('afterTransaction', this.onAfterTransaction);
    this.undoManager.destroy();
    this.listeners.clear();
  }

  private emit(): void {
    const state = this.getState();
    for (const cb of this.listeners) {
      cb(state);
    }
  }
}
