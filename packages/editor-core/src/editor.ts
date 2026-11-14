import { DEFAULT_PAGE_ID, type CanvasNode, type Point, type ViewportState } from '@nova/shared';
import * as Y from 'yjs';
import { ClipboardManager } from './clipboard/clipboard.js';
import { CommandBus } from './commands/commands.js';
import { HistoryManager } from './history/history-manager.js';
import { LOCAL_ORIGIN, serializeDocSnapshot, type DocSnapshot } from './model/doc.js';
import {
  PresenceManager,
  type AwarenessLike,
  type RemotePresence,
} from './presence/presence-manager.js';
import { SceneGraph, type SceneDiff } from './scene/scene-graph.js';
import { SpatialIndex } from './scene/spatial-index.js';
import { SelectionStore, type SelectionSnapshot } from './selection/selection-store.js';
import { ToolManager } from './tools/tool-manager.js';
import { ViewportStore } from './viewport/viewport-store.js';

export interface ExportOpts {
  nodeIds?: string[];
  pageId?: string;
  scale?: number;
  background?: string | null;
}

export interface Renderer<TContainer = unknown, TExport = Uint8Array> {
  mount(el: TContainer): void;
  render(diff: SceneDiff): void;
  setViewport(v: ViewportState): void;
  hitTest(screenPt: Point): string | null;
  exportPNG(opts: ExportOpts): Promise<TExport>;
  destroy(): void;
}

export interface EditorEventMap {
  sceneDiff: { diff: SceneDiff; isRemote: boolean };
  selection: SelectionSnapshot;
  viewport: ViewportState;
  history: { canUndo: boolean; canRedo: boolean };
  presence: RemotePresence[];
  remoteNodeDeleted: { ids: string[]; nodes: CanvasNode[] };
  transient: undefined;
  textEditRequested: { nodeId: string };
}

export type EditorEvent = keyof EditorEventMap;

export interface EditorOptions {
  doc: Y.Doc;
  userId: string;
  userName?: string;
  userColor?: string;
  avatarUrl?: string;
  awareness?: AwarenessLike;
  readOnly?: boolean;
  pageId?: string;
  getViewportSize?: () => { width: number; height: number };
}

export interface EditorDebugSnapshot {
  doc: DocSnapshot;
  selection: string[];
  viewport: ViewportState;
  tool: string;
  presences: RemotePresence[];
  history: { canUndo: boolean; canRedo: boolean };
}

/**
 * Headless collaborative canvas editor facade coordinating commands, incremental scene graph,
 * R-tree spatial index, selection, viewport, tools, local undo/redo, clipboard, and presence.
 */
export class Editor {
  readonly doc: Y.Doc;
  readonly userId: string;
  readonly commands: CommandBus;
  readonly selection: SelectionStore;
  readonly history: HistoryManager;
  readonly viewport: ViewportStore;
  readonly scene: SceneGraph;
  readonly spatialIndex: SpatialIndex;
  readonly clipboard: ClipboardManager;
  readonly presence: PresenceManager;
  readonly tools: ToolManager;

  private readonly eventListeners = new Map<EditorEvent, Set<(payload: never) => void>>();
  private readonly unsubs: Array<() => void> = [];

  constructor(opts: EditorOptions) {
    this.doc = opts.doc;
    this.userId = opts.userId;

    this.commands = new CommandBus(opts.doc, opts.userId, { readOnly: opts.readOnly });
    this.selection = new SelectionStore();
    this.history = new HistoryManager(opts.doc);
    this.viewport = new ViewportStore();
    this.scene = new SceneGraph(opts.doc);
    this.spatialIndex = new SpatialIndex();
    this.spatialIndex.rebuild(this.scene.getAllNodes());
    this.clipboard = new ClipboardManager();
    this.presence = new PresenceManager({
      userId: opts.userId,
      userName: opts.userName,
      userColor: opts.userColor,
      avatarUrl: opts.avatarUrl,
      awareness: opts.awareness,
    });

    this.tools = new ToolManager({
      pageId: opts.pageId ?? DEFAULT_PAGE_ID,
      commands: this.commands,
      scene: this.scene,
      spatialIndex: this.spatialIndex,
      selection: this.selection,
      viewport: this.viewport,
      history: this.history,
      clipboard: this.clipboard,
      presence: this.presence,
      getViewportSize: opts.getViewportSize ?? (() => ({ width: 1280, height: 800 })),
      onTextEditRequested: (nodeId) => this.emit('textEditRequested', { nodeId }),
      onTransientChange: () => this.emit('transient', undefined),
    });

    this.unsubs.push(
      this.scene.subscribe((diff, meta) => {
        this.spatialIndex.applyDiff(diff);
        const isRemote = meta.origin !== LOCAL_ORIGIN;
        if (diff.removed.length > 0) {
          const dropped = this.selection.remove(diff.removed);
          if (isRemote && dropped.length > 0) {
            const deletedNodes = meta.removedNodes.filter((n) => dropped.includes(n.id));
            this.emit('remoteNodeDeleted', { ids: dropped, nodes: deletedNodes });
          }
        }
        this.emit('sceneDiff', { diff, isRemote });
      }),
      this.selection.subscribe((snap) => {
        this.presence.setSelection(snap.ids);
        this.emit('selection', snap);
      }),
      this.viewport.subscribe((vp) => {
        this.presence.setViewport(vp);
        this.emit('viewport', vp);
      }),
      this.history.subscribe((state) => {
        this.emit('history', state);
      }),
      this.presence.subscribe((remotes) => {
        this.emit('presence', remotes);
      }),
    );
  }

  setReadOnly(readOnly: boolean): void {
    this.commands.setReadOnly(readOnly);
  }

  subscribe<K extends EditorEvent>(event: K, cb: (payload: EditorEventMap[K]) => void): () => void {
    let set = this.eventListeners.get(event);
    if (!set) {
      set = new Set();
      this.eventListeners.set(event, set);
    }
    const typedCb = cb as (payload: never) => void;
    set.add(typedCb);
    return () => {
      set.delete(typedCb);
    };
  }

  getDebugSnapshot(): EditorDebugSnapshot {
    return {
      doc: serializeDocSnapshot(this.doc),
      selection: this.selection.getIds(),
      viewport: this.viewport.getState(),
      tool: this.tools.getActiveTool(),
      presences: this.presence.getRemotePresences(),
      history: this.history.getState(),
    };
  }

  destroy(): void {
    while (this.unsubs.length > 0) {
      this.unsubs.pop()!();
    }
    this.tools.destroy();
    this.presence.destroy();
    this.history.destroy();
    this.selection.destroy();
    this.viewport.destroy();
    this.scene.destroy();
    this.spatialIndex.clear();
    this.eventListeners.clear();
  }

  private emit<K extends EditorEvent>(event: K, payload: EditorEventMap[K]): void {
    const set = this.eventListeners.get(event);
    if (!set) {
      return;
    }
    for (const cb of set) {
      (cb as (p: EditorEventMap[K]) => void)(payload);
    }
  }
}
