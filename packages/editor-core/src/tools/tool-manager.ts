import { DEFAULT_PAGE_ID, type CanvasNode, type Point, type ToolId } from '@nova/shared';
import type { ClipboardManager } from '../clipboard/clipboard.js';
import type { CommandBus, CommandResult, EditorCommand } from '../commands/commands.js';
import { getNodeAABB, mergeAABBs, type Rect } from '../geometry/geometry.js';
import type { HistoryManager } from '../history/history-manager.js';
import { getSiblingsSorted } from '../model/doc.js';
import type { PresenceManager } from '../presence/presence-manager.js';
import type { SceneGraph } from '../scene/scene-graph.js';
import type { SpatialIndex } from '../scene/spatial-index.js';
import type { SelectionStore } from '../selection/selection-store.js';
import { computeSnap, type SnapGuide } from '../snapping/snapping.js';
import type { ViewportStore } from '../viewport/viewport-store.js';

export interface EditorPointerEvent {
  /** Screen coordinates relative to canvas container top-left. */
  x: number;
  y: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  button?: number;
}

export interface EditorKeyEvent {
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export interface DraftShape {
  type: 'rect' | 'ellipse' | 'line' | 'text' | 'frame';
  x: number;
  y: number;
  width: number;
  height: number;
  points?: number[];
}

export interface DragPreviewState {
  ids: string[];
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface KeyActionResult {
  handled: boolean;
  copiedText?: string;
  fitRequested?: boolean;
  editTextId?: string;
}

export interface ToolContext {
  pageId: string;
  commands: CommandBus;
  scene: SceneGraph;
  spatialIndex: SpatialIndex;
  selection: SelectionStore;
  viewport: ViewportStore;
  history: HistoryManager;
  clipboard: ClipboardManager;
  presence: PresenceManager;
  getViewportSize: () => { width: number; height: number };
  onTextEditRequested?: (nodeId: string) => void;
  onTransientChange?: () => void;
}

type InteractionState =
  | { kind: 'idle' }
  | { kind: 'pan'; lastScreen: Point }
  | {
      kind: 'drag';
      startWorld: Point;
      ids: string[];
      initialRect: Rect;
      dx: number;
      dy: number;
      guides: SnapGuide[];
    }
  | { kind: 'marquee'; startWorld: Point }
  | {
      kind: 'draw';
      tool: 'rect' | 'ellipse' | 'line' | 'text' | 'frame';
      startWorld: Point;
      draft: DraftShape;
    };

function normalizeRect(a: Point, b: Point, square = false): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  }
  return {
    x: dx < 0 ? a.x + dx : a.x,
    y: dy < 0 ? a.y + dy : a.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/**
 * Finite-state machine for active editor tools (`select`, `hand`, shape/text/frame creation)
 * and standard design-editor keyboard shortcuts (`05-EDITOR-CORE.md`).
 */
export class ToolManager {
  private activeTool: ToolId = 'select';
  private toolBeforeSpace: ToolId | null = null;
  private interaction: InteractionState = { kind: 'idle' };
  private readonly toolListeners = new Set<(tool: ToolId) => void>();

  constructor(private readonly ctx: ToolContext) {}

  getActiveTool(): ToolId {
    return this.toolBeforeSpace ? 'hand' : this.activeTool;
  }

  setTool(tool: ToolId): void {
    if (this.ctx.commands.isReadOnly() && tool !== 'select' && tool !== 'hand') {
      return;
    }
    if (this.activeTool === tool && !this.toolBeforeSpace) {
      return;
    }
    this.activeTool = tool;
    this.toolBeforeSpace = null;
    this.cancelInteraction();
    this.ctx.presence.setTool(tool);
    for (const cb of this.toolListeners) {
      cb(tool);
    }
    this.ctx.onTransientChange?.();
  }

  subscribeToolChange(cb: (tool: ToolId) => void): () => void {
    this.toolListeners.add(cb);
    return () => {
      this.toolListeners.delete(cb);
    };
  }

  getDraftShape(): DraftShape | null {
    return this.interaction.kind === 'draw' ? this.interaction.draft : null;
  }

  getDragPreview(): DragPreviewState | null {
    if (this.interaction.kind !== 'drag') {
      return null;
    }
    return {
      ids: this.interaction.ids,
      dx: this.interaction.dx,
      dy: this.interaction.dy,
      guides: this.interaction.guides,
    };
  }

  handlePointerDown(e: EditorPointerEvent): void {
    const effectiveTool = this.getActiveTool();
    const screenPt: Point = { x: e.x, y: e.y };
    const worldPt = this.ctx.viewport.screenToWorld(screenPt);
    this.ctx.presence.setCursor(worldPt);

    if (effectiveTool === 'hand' || e.button === 1) {
      this.interaction = { kind: 'pan', lastScreen: screenPt };
      return;
    }

    if (effectiveTool === 'select') {
      const hit = this.ctx.spatialIndex.hitTestPoint(worldPt, this.ctx.scene, {
        pageId: this.ctx.pageId,
      });

      if (hit) {
        if (e.shiftKey) {
          this.ctx.selection.toggle(hit.id);
        } else if (!this.ctx.selection.has(hit.id)) {
          this.ctx.selection.set([hit.id]);
        }

        const selectedNodes = this.getSelectedEditableNodes();
        if (!this.ctx.commands.isReadOnly() && selectedNodes.length > 0) {
          const merged = mergeAABBs(selectedNodes.map((n) => getNodeAABB(n)));
          if (merged) {
            this.interaction = {
              kind: 'drag',
              startWorld: worldPt,
              ids: selectedNodes.map((n) => n.id),
              initialRect: {
                x: merged.minX,
                y: merged.minY,
                width: merged.maxX - merged.minX,
                height: merged.maxY - merged.minY,
              },
              dx: 0,
              dy: 0,
              guides: [],
            };
          }
        }
      } else {
        if (!e.shiftKey) {
          this.ctx.selection.clear();
        }
        this.interaction = { kind: 'marquee', startWorld: worldPt };
        this.ctx.selection.setMarqueeRect({ x: worldPt.x, y: worldPt.y, width: 0, height: 0 });
      }
      this.ctx.onTransientChange?.();
      return;
    }

    if (
      !this.ctx.commands.isReadOnly() &&
      (effectiveTool === 'rect' ||
        effectiveTool === 'ellipse' ||
        effectiveTool === 'line' ||
        effectiveTool === 'text' ||
        effectiveTool === 'frame')
    ) {
      const draft: DraftShape =
        effectiveTool === 'line'
          ? {
              type: 'line',
              x: worldPt.x,
              y: worldPt.y,
              width: 0,
              height: 0,
              points: [0, 0, 0, 0],
            }
          : {
              type: effectiveTool,
              x: worldPt.x,
              y: worldPt.y,
              width: 0,
              height: 0,
            };
      this.interaction = {
        kind: 'draw',
        tool: effectiveTool,
        startWorld: worldPt,
        draft,
      };
      this.ctx.onTransientChange?.();
    }
  }

  handlePointerMove(e: EditorPointerEvent): void {
    const screenPt: Point = { x: e.x, y: e.y };
    const worldPt = this.ctx.viewport.screenToWorld(screenPt);
    this.ctx.presence.setCursor(worldPt);

    if (this.interaction.kind === 'pan') {
      const dxScreen = screenPt.x - this.interaction.lastScreen.x;
      const dyScreen = screenPt.y - this.interaction.lastScreen.y;
      this.interaction.lastScreen = screenPt;
      this.ctx.viewport.panBy(dxScreen, dyScreen);
      return;
    }

    if (this.interaction.kind === 'drag') {
      const rawDx = worldPt.x - this.interaction.startWorld.x;
      const rawDy = worldPt.y - this.interaction.startWorld.y;
      const movingSet = new Set(this.interaction.ids);
      const snap = computeSnap({
        movingIds: movingSet,
        proposedRect: {
          x: this.interaction.initialRect.x + rawDx,
          y: this.interaction.initialRect.y + rawDy,
          width: this.interaction.initialRect.width,
          height: this.interaction.initialRect.height,
        },
        candidates: this.ctx.scene.getAllNodes(this.ctx.pageId),
        zoom: this.ctx.viewport.getState().zoom,
      });

      this.interaction.dx = rawDx + snap.dx;
      this.interaction.dy = rawDy + snap.dy;
      this.interaction.guides = snap.guides;
      this.ctx.presence.setDragging({
        ids: this.interaction.ids,
        dx: this.interaction.dx,
        dy: this.interaction.dy,
      });
      this.ctx.onTransientChange?.();
      return;
    }

    if (this.interaction.kind === 'marquee') {
      const rect = normalizeRect(this.interaction.startWorld, worldPt, false);
      this.ctx.selection.setMarqueeRect(rect);
      this.ctx.onTransientChange?.();
      return;
    }

    if (this.interaction.kind === 'draw') {
      if (this.interaction.tool === 'line') {
        const dx = worldPt.x - this.interaction.startWorld.x;
        const dy = worldPt.y - this.interaction.startWorld.y;
        this.interaction.draft = {
          type: 'line',
          x: this.interaction.startWorld.x,
          y: this.interaction.startWorld.y,
          width: Math.abs(dx),
          height: Math.abs(dy),
          points: [0, 0, dx, dy],
        };
      } else {
        const rect = normalizeRect(this.interaction.startWorld, worldPt, Boolean(e.shiftKey));
        this.interaction.draft = {
          type: this.interaction.tool,
          ...rect,
        };
      }
      this.ctx.onTransientChange?.();
      return;
    }

    if (this.getActiveTool() === 'select') {
      const hit = this.ctx.spatialIndex.hitTestPoint(worldPt, this.ctx.scene, {
        pageId: this.ctx.pageId,
      });
      this.ctx.selection.setHovered(hit?.id ?? null);
    }
  }

  handlePointerUp(e: EditorPointerEvent): void {
    const worldPt = this.ctx.viewport.screenToWorld({ x: e.x, y: e.y });
    this.ctx.presence.setCursor(worldPt);

    if (this.interaction.kind === 'pan') {
      this.interaction = { kind: 'idle' };
      return;
    }

    if (this.interaction.kind === 'drag') {
      const { ids, dx, dy } = this.interaction;
      this.interaction = { kind: 'idle' };
      this.ctx.presence.setDragging(undefined);
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        this.executeDiscrete({ type: 'moveNodes', ids, dx, dy });
      }
      this.ctx.onTransientChange?.();
      return;
    }

    if (this.interaction.kind === 'marquee') {
      const rect = this.ctx.selection.getMarqueeRect();
      this.interaction = { kind: 'idle' };
      this.ctx.selection.setMarqueeRect(null);
      if (rect && (rect.width > 2 || rect.height > 2)) {
        const candidateIds = new Set(this.ctx.spatialIndex.searchRect(rect));
        const matched = this.ctx.scene
          .getAllNodes(this.ctx.pageId)
          .filter(
            (n) =>
              candidateIds.has(n.id) &&
              n.visible &&
              !n.locked &&
              n.type !== 'group',
          )
          .map((n) => n.id);
        if (e.shiftKey) {
          this.ctx.selection.add(matched);
        } else {
          this.ctx.selection.set(matched);
        }
      }
      this.ctx.onTransientChange?.();
      return;
    }

    if (this.interaction.kind === 'draw') {
      const { tool, draft } = this.interaction;
      this.interaction = { kind: 'idle' };

      const isTinyClick =
        tool === 'line'
          ? Math.hypot(draft.points?.[2] ?? 0, draft.points?.[3] ?? 0) < 4
          : draft.width < 4 && draft.height < 4;

      const input =
        tool === 'line'
          ? {
              type: 'line' as const,
              pageId: this.ctx.pageId,
              x: draft.x,
              y: draft.y,
              width: isTinyClick ? 120 : draft.width,
              height: isTinyClick ? 0 : draft.height,
              points: isTinyClick ? [0, 0, 120, 0] : (draft.points ?? [0, 0, 120, 0]),
            }
          : {
              type: tool,
              pageId: this.ctx.pageId,
              x: draft.x,
              y: draft.y,
              width: isTinyClick
                ? tool === 'frame'
                  ? 400
                  : tool === 'text'
                    ? 200
                    : 120
                : Math.max(4, draft.width),
              height: isTinyClick
                ? tool === 'frame'
                  ? 300
                  : tool === 'text'
                    ? 40
                    : 100
                : Math.max(4, draft.height),
            };

      const res = this.executeDiscrete({ type: 'createNode', input });
      if (res.createdIds[0]) {
        this.ctx.selection.set([res.createdIds[0]]);
        if (tool === 'text') {
          this.ctx.onTextEditRequested?.(res.createdIds[0]);
        }
      }
      this.setTool('select');
    }
  }

  handleKeyDown(e: EditorKeyEvent): KeyActionResult {
    const mod = Boolean(e.metaKey || e.ctrlKey);
    const keyLower = e.key.toLowerCase();

    if (e.code === 'Space' || e.key === ' ') {
      if (!this.toolBeforeSpace) {
        this.toolBeforeSpace = this.activeTool;
        this.ctx.presence.setTool('hand');
        for (const cb of this.toolListeners) {
          cb('hand');
        }
      }
      return { handled: true };
    }

    if (mod && keyLower === 'z') {
      if (!this.ctx.commands.isReadOnly()) {
        if (e.shiftKey) {
          this.ctx.history.redo();
        } else {
          this.ctx.history.undo();
        }
      }
      return { handled: true };
    }

    if (mod && keyLower === 'y') {
      if (!this.ctx.commands.isReadOnly()) {
        this.ctx.history.redo();
      }
      return { handled: true };
    }

    if (mod && keyLower === 'a') {
      const allIds = this.ctx.scene
        .getAllNodes(this.ctx.pageId)
        .filter((n) => n.visible && !n.locked && n.parentId === null)
        .map((n) => n.id);
      this.ctx.selection.set(allIds);
      return { handled: true };
    }

    if (mod && keyLower === 'c') {
      const selected = this.getSelectedNodes();
      if (selected.length > 0) {
        const serialized = this.ctx.clipboard.copy(selected);
        return { handled: true, copiedText: serialized };
      }
      return { handled: true };
    }

    if (mod && keyLower === 'v') {
      const clip = this.ctx.clipboard.readInternal();
      if (clip && !this.ctx.commands.isReadOnly()) {
        const res = this.executeDiscrete({
          type: 'pasteNodes',
          nodes: clip.nodes,
          offset: clip.offset,
          targetPageId: this.ctx.pageId,
        });
        if (res.createdIds.length > 0) {
          this.ctx.selection.set(res.createdIds);
        }
      }
      return { handled: true };
    }

    if (mod && keyLower === 'd') {
      const ids = this.ctx.selection.getIds();
      if (ids.length > 0 && !this.ctx.commands.isReadOnly()) {
        const res = this.executeDiscrete({ type: 'duplicate', ids });
        if (res.createdIds.length > 0) {
          this.ctx.selection.set(res.createdIds);
        }
      }
      return { handled: true };
    }

    if (mod && keyLower === 'g') {
      const ids = this.ctx.selection.getIds();
      if (!this.ctx.commands.isReadOnly()) {
        if (e.shiftKey && ids.length === 1) {
          const target = this.ctx.scene.getNode(ids[0]!);
          if (target?.type === 'group') {
            const res = this.executeDiscrete({ type: 'ungroup', id: target.id });
            this.ctx.selection.set(res.updatedIds);
          }
        } else if (!e.shiftKey && ids.length >= 1) {
          const res = this.executeDiscrete({ type: 'group', ids });
          if (res.createdIds[0]) {
            this.ctx.selection.set([res.createdIds[0]]);
          }
        }
      }
      return { handled: true };
    }

    if (mod && e.key === '0') {
      this.ctx.viewport.zoomTo100();
      return { handled: true };
    }

    if (e.shiftKey && (e.key === '1' || e.key === '!' || e.code === 'Digit1')) {
      this.ctx.viewport.fitToNodes(
        this.ctx.scene.getAllNodes(this.ctx.pageId),
        this.ctx.getViewportSize(),
      );
      return { handled: true, fitRequested: true };
    }

    if (mod && (e.key === ']' || e.key === '[')) {
      this.nudgeZOrder(e.key === ']' ? 'forward' : 'backward');
      return { handled: true };
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const ids = this.ctx.selection.getIds();
      if (ids.length > 0 && !this.ctx.commands.isReadOnly()) {
        this.executeDiscrete({ type: 'deleteNodes', ids });
        this.ctx.selection.clear();
      }
      return { handled: true };
    }

    if (e.key === 'Escape') {
      this.cancelInteraction();
      this.ctx.selection.clear();
      this.setTool('select');
      return { handled: true };
    }

    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      const ids = this.ctx.selection.getIds();
      if (ids.length > 0 && !this.ctx.commands.isReadOnly()) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.ctx.commands.execute({ type: 'moveNodes', ids, dx, dy });
        return { handled: true };
      }
      return { handled: false };
    }

    if (!mod && !e.altKey) {
      const toolMap: Record<string, ToolId> = {
        v: 'select',
        h: 'hand',
        r: 'rect',
        o: 'ellipse',
        l: 'line',
        t: 'text',
        f: 'frame',
      };
      const nextTool = toolMap[keyLower];
      if (nextTool) {
        if (this.ctx.commands.isReadOnly() && nextTool !== 'select' && nextTool !== 'hand') {
          return { handled: false };
        }
        this.setTool(nextTool);
        return { handled: true };
      }
    }

    return { handled: false };
  }

  handleKeyUp(e: EditorKeyEvent): void {
    if (e.code === 'Space' || e.key === ' ') {
      if (this.toolBeforeSpace) {
        const prev = this.toolBeforeSpace;
        this.toolBeforeSpace = null;
        this.ctx.presence.setTool(prev);
        for (const cb of this.toolListeners) {
          cb(prev);
        }
        if (this.interaction.kind === 'pan') {
          this.interaction = { kind: 'idle' };
        }
      }
    }
  }

  destroy(): void {
    this.cancelInteraction();
    this.toolListeners.clear();
  }

  private executeDiscrete(cmd: EditorCommand): CommandResult {
    this.ctx.history.stopCapturing();
    const res = this.ctx.commands.execute(cmd);
    this.ctx.history.stopCapturing();
    return res;
  }

  private cancelInteraction(): void {
    if (this.interaction.kind === 'drag') {
      this.ctx.presence.setDragging(undefined);
    }
    if (this.interaction.kind === 'marquee') {
      this.ctx.selection.setMarqueeRect(null);
    }
    this.interaction = { kind: 'idle' };
  }

  private getSelectedNodes(): CanvasNode[] {
    const out: CanvasNode[] = [];
    for (const id of this.ctx.selection.getIds()) {
      const node = this.ctx.scene.getNode(id);
      if (node) {
        out.push(node);
      }
    }
    return out;
  }

  private getSelectedEditableNodes(): CanvasNode[] {
    return this.getSelectedNodes().filter((n) => !n.locked);
  }

  private nudgeZOrder(direction: 'forward' | 'backward'): void {
    const ids = this.ctx.selection.getIds();
    const firstId = ids[0];
    if (!firstId || this.ctx.commands.isReadOnly()) {
      return;
    }
    const target = this.ctx.scene.getNode(firstId);
    if (!target) {
      return;
    }
    const siblings = getSiblingsSorted(this.ctx.commands['doc'], target.pageId, target.parentId);
    const idx = siblings.findIndex((s) => s.id === target.id);
    if (idx < 0) {
      return;
    }

    if (direction === 'forward' && idx + 1 < siblings.length) {
      const after = siblings[idx + 1]!;
      const before = siblings[idx + 2];
      this.ctx.commands.execute({
        type: 'reorder',
        nodeId: target.id,
        afterIndex: after.index,
        beforeIndex: before?.index ?? null,
      });
    } else if (direction === 'backward' && idx > 0) {
      const before = siblings[idx - 1]!;
      const after = siblings[idx - 2];
      this.ctx.commands.execute({
        type: 'reorder',
        nodeId: target.id,
        afterIndex: after?.index ?? null,
        beforeIndex: before.index,
      });
    }
  }
}

export { DEFAULT_PAGE_ID };
