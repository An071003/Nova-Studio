import {
  DEFAULT_PAGE_ID,
  type CanvasNode,
  type Point,
  type ViewportState,
} from '@nova/shared';
import {
  getNodeAABB,
  mergeAABBs,
  type Editor,
  type ExportOpts,
  type RemotePresence,
  type Renderer,
  type SceneDiff,
  type SelectionSnapshot,
} from '@nova/editor-core';
import Konva from 'konva';
import {
  applyNodeAttrsToShape,
  createShapeForNode,
  type AssetUrlResolver,
  type ImageCacheEntry,
} from './konva-shapes.js';

export interface KonvaRendererOptions {
  pageId?: string;
  resolveAssetUrl?: AssetUrlResolver;
  onTextEditRequested?: (node: CanvasNode, screenRect: { x: number; y: number; width: number; height: number }) => void;
}

interface CursorVisualState {
  current: Point;
  target: Point;
  name: string;
  color: string;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8.0;

function readThemeVar(container: HTMLElement | null, name: string, fallback: string): string {
  if (!container || typeof globalThis.getComputedStyle !== 'function') {
    return fallback;
  }
  const value = globalThis.getComputedStyle(container).getPropertyValue(name).trim();
  return value || fallback;
}

export class KonvaRenderer implements Renderer<HTMLElement, Uint8Array> {
  private readonly editor: Editor;
  private readonly pageId: string;
  private readonly resolveAssetUrl?: AssetUrlResolver;
  private readonly onTextEditRequested?: KonvaRendererOptions['onTextEditRequested'];

  private container: HTMLElement | null = null;
  private stage: Konva.Stage | null = null;
  private bgLayer: Konva.Layer | null = null;
  private sceneLayer: Konva.Layer | null = null;
  private overlayLayer: Konva.Layer | null = null;

  private transformer: Konva.Transformer | null = null;
  private marqueeRect: Konva.Rect | null = null;
  private draftGroup: Konva.Group | null = null;
  private guidesGroup: Konva.Group | null = null;
  private remoteSelectionsGroup: Konva.Group | null = null;
  private remoteCursorsGroup: Konva.Group | null = null;

  private readonly shapesById = new Map<string, Konva.Shape>();
  private readonly imageCache = new Map<string, ImageCacheEntry>();
  private readonly cursorStates = new Map<number, CursorVisualState>();

  private activeDragOffsetIds = new Set<string>();
  private pointerCaptureActive = false;
  private destroyed = false;
  private rafHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unsubs: Array<() => void> = [];

  private accentColor = '#7C5CFF';
  private accentSecondary = '#22D3EE';
  private dotColor = '#2A2D35';
  private panelTextColor = '#E8EAF0';

  constructor(editor: Editor, options?: KonvaRendererOptions) {
    this.editor = editor;
    this.pageId = options?.pageId ?? DEFAULT_PAGE_ID;
    this.resolveAssetUrl = options?.resolveAssetUrl;
    this.onTextEditRequested = options?.onTextEditRequested;
  }

  mount(el: HTMLElement): void {
    if (this.stage) {
      this.destroy();
    }
    this.destroyed = false;
    this.container = el;

    this.accentColor = readThemeVar(el, '--accent', '#7C5CFF');
    this.accentSecondary = readThemeVar(el, '--accent-2', '#22D3EE');
    this.dotColor = readThemeVar(el, '--bg-canvas-dot', '#2A2D35');
    this.panelTextColor = readThemeVar(el, '--text-primary', '#E8EAF0');

    const width = Math.max(1, el.clientWidth || 1200);
    const height = Math.max(1, el.clientHeight || 800);

    this.stage = new Konva.Stage({
      container: el as HTMLDivElement,
      width,
      height,
    });

    this.bgLayer = new Konva.Layer({ listening: false });
    this.sceneLayer = new Konva.Layer();
    this.overlayLayer = new Konva.Layer();

    const gridShape = new Konva.Shape({
      listening: false,
      sceneFunc: (ctx: Konva.Context) => {
        const stage = this.stage;
        if (!stage) return;
        const vp = this.editor.viewport.getState();
        const w = stage.width();
        const h = stage.height();
        const baseStep = 24;
        let step = baseStep * vp.zoom;
        while (step < 14) step *= 2;
        while (step > 56) step /= 2;

        const offsetX = ((vp.x % step) + step) % step;
        const offsetY = ((vp.y % step) + step) % step;

        ctx.fillStyle = this.dotColor;
        for (let x = offsetX; x < w; x += step) {
          for (let y = offsetY; y < h; y += step) {
            ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
          }
        }
      },
    });
    this.bgLayer.add(gridShape);

    this.draftGroup = new Konva.Group({ listening: false });
    this.guidesGroup = new Konva.Group({ listening: false });
    this.remoteSelectionsGroup = new Konva.Group({ listening: false });
    this.remoteCursorsGroup = new Konva.Group({ listening: false });

    this.marqueeRect = new Konva.Rect({
      visible: false,
      listening: false,
      stroke: this.accentSecondary,
      strokeWidth: 1,
      fill: `${this.accentSecondary}22`,
    });

    this.transformer = new Konva.Transformer({
      borderStroke: this.accentColor,
      borderStrokeWidth: 1.5,
      anchorStroke: this.accentColor,
      anchorFill: this.panelTextColor,
      anchorSize: 8,
      anchorCornerRadius: 2,
      rotateAnchorOffset: 24,
      keepRatio: false,
      ignoreStroke: true,
    });
    this.transformer.on('transformend', () => this.commitTransformerChanges());

    this.overlayLayer.add(
      this.draftGroup,
      this.marqueeRect,
      this.guidesGroup,
      this.remoteSelectionsGroup,
      this.transformer,
      this.remoteCursorsGroup,
    );

    this.stage.add(this.bgLayer, this.sceneLayer, this.overlayLayer);

    this.rebuildAllNodes();
    this.setViewport(this.editor.viewport.getState());
    this.syncSelection(this.editor.selection.getSnapshot());
    this.syncRemotePresences(this.editor.presence.getRemotePresences());

    this.unsubs.push(
      this.editor.subscribe('sceneDiff', ({ diff }) => {
        this.render(diff);
      }),
      this.editor.subscribe('viewport', (vp) => {
        this.setViewport(vp);
      }),
      this.editor.subscribe('selection', (snap) => {
        this.syncSelection(snap);
      }),
      this.editor.subscribe('transient', () => {
        this.syncTransient();
      }),
      this.editor.subscribe('presence', (remotes) => {
        this.syncRemotePresences(remotes);
      }),
      this.editor.subscribe('textEditRequested', ({ nodeId }) => {
        const node = this.editor.scene.getNode(nodeId);
        if (!node || !this.onTextEditRequested) return;
        const topLeft = this.editor.viewport.worldToScreen({ x: node.x, y: node.y });
        const zoom = this.editor.viewport.getState().zoom;
        this.onTextEditRequested(node, {
          x: topLeft.x,
          y: topLeft.y,
          width: Math.max(80, node.width * zoom),
          height: Math.max(32, node.height * zoom),
        });
      }),
    );

    this.bindDomEvents(el);
    this.bindResizeObserver(el);
  }

  render(diff: SceneDiff): void {
    const sceneLayer = this.sceneLayer;
    if (!sceneLayer) return;

    for (const removedId of diff.removed) {
      const shape = this.shapesById.get(removedId);
      if (shape) {
        shape.destroy();
        this.shapesById.delete(removedId);
      }
    }

    for (const addedNode of diff.added) {
      if (addedNode.pageId !== this.pageId) continue;
      this.upsertNodeShape(addedNode);
    }

    for (const { node } of diff.updated) {
      if (node.pageId !== this.pageId) continue;
      this.upsertNodeShape(node);
    }

    if (diff.orderChanged || diff.added.length > 0) {
      this.syncZOrder();
    }

    this.syncTransformerNodes(this.editor.selection.getIds());
    sceneLayer.batchDraw();
    this.overlayLayer?.batchDraw();
  }

  setViewport(v: ViewportState): void {
    if (!this.sceneLayer || !this.overlayLayer || !this.bgLayer) return;
    for (const layer of [this.sceneLayer]) {
      layer.position({ x: v.x, y: v.y });
      layer.scale({ x: v.zoom, y: v.zoom });
    }

    // Keep world-space overlay children aligned to viewport, while remote cursors stay in screen space
    for (const group of [
      this.draftGroup,
      this.guidesGroup,
      this.remoteSelectionsGroup,
      this.marqueeRect,
    ]) {
      group?.position({ x: v.x, y: v.y });
      group?.scale({ x: v.zoom, y: v.zoom });
    }
    if (this.transformer) {
      // Transformer sits inside overlayLayer at default scale so handles transform shapes in sceneLayer accurately
      this.transformer.forceUpdate();
    }

    this.bgLayer.batchDraw();
    this.sceneLayer.batchDraw();
    this.overlayLayer.batchDraw();
  }

  hitTest(screenPt: Point): string | null {
    if (!this.stage) return null;
    const hit = this.stage.getIntersection(screenPt);
    if (!hit) return null;
    if (hit.getParent()?.className === 'Transformer') {
      return null;
    }
    const id = hit.id();
    return id || null;
  }

  async exportDataURL(opts: ExportOpts = {}): Promise<string> {
    if (!this.stage || !this.sceneLayer || !this.bgLayer || !this.overlayLayer) {
      throw new Error('KonvaRenderer is not mounted');
    }

    const scale = Math.max(0.25, opts.scale ?? 1);
    const pageId = opts.pageId ?? this.pageId;
    const targetNodes =
      opts.nodeIds && opts.nodeIds.length > 0
        ? opts.nodeIds
            .map((id) => this.editor.scene.getNode(id))
            .filter((n): n is CanvasNode => Boolean(n && n.visible))
        : this.editor.scene.getAllNodes(pageId).filter((n) => n.visible);

    const prevBgVisible = this.bgLayer.visible();
    const prevOverlayVisible = this.overlayLayer.visible();
    const prevPos = { ...this.sceneLayer.position() };
    const prevScale = { ...this.sceneLayer.scale() };

    let bgRect: Konva.Rect | null = null;
    try {
      this.bgLayer.visible(false);
      this.overlayLayer.visible(false);

      const merged = mergeAABBs(targetNodes.map((n) => getNodeAABB(n)));
      if (!merged) {
        return this.stage.toDataURL({ pixelRatio: scale });
      }

      const padding = 16;
      const worldX = merged.minX - padding;
      const worldY = merged.minY - padding;
      const worldW = Math.max(1, merged.maxX - merged.minX + padding * 2);
      const worldH = Math.max(1, merged.maxY - merged.minY + padding * 2);

      const hiddenForSelection: Konva.Shape[] = [];
      if (opts.nodeIds && opts.nodeIds.length > 0) {
        const allow = new Set(opts.nodeIds);
        for (const [id, shape] of this.shapesById) {
          if (!allow.has(id) && shape.visible()) {
            shape.visible(false);
            hiddenForSelection.push(shape);
          }
        }
      }

      // Render cleanly from origin (0, 0) in unscaled world pixels so pixelRatio = exact scale
      this.sceneLayer.position({ x: -worldX, y: -worldY });
      this.sceneLayer.scale({ x: 1, y: 1 });

      if (opts.background) {
        bgRect = new Konva.Rect({
          x: worldX,
          y: worldY,
          width: worldW,
          height: worldH,
          fill: opts.background,
          listening: false,
        });
        this.sceneLayer.add(bgRect);
        bgRect.moveToBottom();
      }

      this.sceneLayer.draw();
      const dataUrl = this.sceneLayer.toDataURL({
        x: 0,
        y: 0,
        width: worldW,
        height: worldH,
        pixelRatio: scale,
      });

      for (const shape of hiddenForSelection) {
        shape.visible(true);
      }
      return dataUrl;
    } finally {
      if (bgRect) {
        bgRect.destroy();
      }
      this.sceneLayer.position(prevPos);
      this.sceneLayer.scale(prevScale);
      this.bgLayer.visible(prevBgVisible);
      this.overlayLayer.visible(prevOverlayVisible);
      this.bgLayer.batchDraw();
      this.sceneLayer.batchDraw();
      this.overlayLayer.batchDraw();
    }
  }

  async exportPNG(opts: ExportOpts = {}): Promise<Uint8Array> {
    const dataUrl = await this.exportDataURL(opts);
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) {
      return new Uint8Array();
    }
    const base64 = dataUrl.slice(commaIdx + 1);
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  getMountedShapeCount(): number {
    return this.shapesById.size;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafHandle !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    while (this.unsubs.length > 0) {
      this.unsubs.pop()!();
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.shapesById.clear();
    this.cursorStates.clear();
    this.stage?.destroy();
    this.stage = null;
    this.bgLayer = null;
    this.sceneLayer = null;
    this.overlayLayer = null;
    this.container = null;
  }

  private rebuildAllNodes(): void {
    if (!this.sceneLayer) return;
    this.sceneLayer.destroyChildren();
    this.shapesById.clear();

    const nodes = this.editor.scene.getAllNodes(this.pageId);
    for (const node of nodes) {
      const shape = createShapeForNode(node);
      this.shapesById.set(node.id, shape);
      this.sceneLayer.add(shape);
      applyNodeAttrsToShape(shape, node, {
        loadedImage: this.getOrLoadImage(node),
      });
    }
    this.sceneLayer.batchDraw();
  }

  private upsertNodeShape(node: CanvasNode): void {
    if (!this.sceneLayer) return;
    let shape = this.shapesById.get(node.id);
    if (!shape) {
      shape = createShapeForNode(node);
      this.shapesById.set(node.id, shape);
      this.sceneLayer.add(shape);
    }
    applyNodeAttrsToShape(shape, node, {
      loadedImage: this.getOrLoadImage(node),
    });
  }

  private syncZOrder(): void {
    const ordered = this.editor.scene.getAllNodes(this.pageId);
    ordered.forEach((node, index) => {
      const shape = this.shapesById.get(node.id);
      shape?.zIndex(index);
    });
  }

  private getOrLoadImage(node: CanvasNode): HTMLImageElement | null {
    if (node.type !== 'image' || !node.assetId || !this.resolveAssetUrl) {
      return null;
    }
    const existing = this.imageCache.get(node.assetId);
    if (existing) {
      return existing.element;
    }

    const entry: ImageCacheEntry = { url: null, element: null, status: 'loading' };
    this.imageCache.set(node.assetId, entry);

    Promise.resolve(this.resolveAssetUrl(node.assetId))
      .then((url) => {
        if (this.destroyed || !url || typeof globalThis.Image === 'undefined') {
          entry.status = 'error';
          return;
        }
        entry.url = url;
        const img = new globalThis.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (this.destroyed) return;
          entry.element = img;
          entry.status = 'loaded';
          for (const candidate of this.editor.scene.getAllNodes(this.pageId)) {
            if (candidate.type === 'image' && candidate.assetId === node.assetId) {
              const s = this.shapesById.get(candidate.id);
              if (s) {
                applyNodeAttrsToShape(s, candidate, { loadedImage: img });
              }
            }
          }
          this.sceneLayer?.batchDraw();
        };
        img.onerror = () => {
          entry.status = 'error';
        };
        img.src = url;
      })
      .catch(() => {
        entry.status = 'error';
      });

    return null;
  }

  private syncSelection(snap: SelectionSnapshot): void {
    this.syncTransformerNodes(snap.ids);
    if (this.marqueeRect) {
      if (snap.marqueeRect) {
        this.marqueeRect.setAttrs({
          visible: true,
          x: snap.marqueeRect.x,
          y: snap.marqueeRect.y,
          width: snap.marqueeRect.width,
          height: snap.marqueeRect.height,
        });
      } else {
        this.marqueeRect.visible(false);
      }
    }
    this.overlayLayer?.batchDraw();
  }

  private syncTransformerNodes(ids: string[]): void {
    if (!this.transformer) return;
    if (this.editor.commands.isReadOnly() || this.editor.tools.getDragPreview()) {
      this.transformer.nodes([]);
      return;
    }

    const editableShapes: Konva.Node[] = [];
    for (const id of ids) {
      const model = this.editor.scene.getNode(id);
      const shape = this.shapesById.get(id);
      if (model && !model.locked && model.visible && model.type !== 'group' && shape) {
        editableShapes.push(shape);
      }
    }
    this.transformer.nodes(editableShapes);
  }

  private syncTransient(): void {
    const dragPreview = this.editor.tools.getDragPreview();
    const remotes = this.editor.presence.getRemotePresences();

    // Compute transient drag offsets per nodeId (local drag overrides remote drag)
    const offsets = new Map<string, Point>();
    for (const remote of remotes) {
      const drag = remote.presence.dragging;
      if (!drag) continue;
      for (const id of drag.ids) {
        offsets.set(id, { x: drag.dx, y: drag.dy });
      }
    }
    if (dragPreview) {
      for (const id of dragPreview.ids) {
        offsets.set(id, { x: dragPreview.dx, y: dragPreview.dy });
      }
    }

    const nextActive = new Set<string>(offsets.keys());
    const dirtyIds = new Set<string>([...this.activeDragOffsetIds, ...nextActive]);

    for (const id of dirtyIds) {
      const node = this.editor.scene.getNode(id);
      const shape = this.shapesById.get(id);
      if (!node || !shape) continue;
      const offset = offsets.get(id);
      applyNodeAttrsToShape(shape, node, {
        dragDx: offset?.x ?? 0,
        dragDy: offset?.y ?? 0,
        loadedImage: this.getOrLoadImage(node),
      });
    }
    this.activeDragOffsetIds = nextActive;

    // Render draft shape while user draws rect/ellipse/line/text/frame
    if (this.draftGroup) {
      this.draftGroup.destroyChildren();
      const draft = this.editor.tools.getDraftShape();
      if (draft) {
        if (draft.type === 'ellipse') {
          this.draftGroup.add(
            new Konva.Ellipse({
              x: draft.x + draft.width / 2,
              y: draft.y + draft.height / 2,
              radiusX: Math.max(1, draft.width / 2),
              radiusY: Math.max(1, draft.height / 2),
              stroke: this.accentColor,
              strokeWidth: 1.5,
              dash: [4, 4],
              fill: `${this.accentColor}22`,
            }),
          );
        } else if (draft.type === 'line') {
          this.draftGroup.add(
            new Konva.Line({
              x: draft.x,
              y: draft.y,
              points: draft.points ?? [0, 0, draft.width, draft.height],
              stroke: this.accentColor,
              strokeWidth: 2,
              dash: [4, 4],
            }),
          );
        } else {
          this.draftGroup.add(
            new Konva.Rect({
              x: draft.x,
              y: draft.y,
              width: Math.max(1, draft.width),
              height: Math.max(1, draft.height),
              stroke: this.accentColor,
              strokeWidth: 1.5,
              dash: [4, 4],
              fill: `${this.accentColor}22`,
            }),
          );
        }
      }
    }

    // Render snap guides
    if (this.guidesGroup) {
      this.guidesGroup.destroyChildren();
      const guides = dragPreview?.guides ?? [];
      for (const guide of guides) {
        const points =
          guide.orientation === 'vertical'
            ? [guide.position, guide.start, guide.position, guide.end]
            : [guide.start, guide.position, guide.end, guide.position];
        this.guidesGroup.add(
          new Konva.Line({
            points,
            stroke: this.accentSecondary,
            strokeWidth: 1,
            dash: [4, 3],
          }),
        );
      }
    }

    this.syncTransformerNodes(this.editor.selection.getIds());
    this.sceneLayer?.batchDraw();
    this.overlayLayer?.batchDraw();
  }

  private syncRemotePresences(remotes: RemotePresence[]): void {
    // 1. Sync remote selection outlines immediately
    if (this.remoteSelectionsGroup) {
      this.remoteSelectionsGroup.destroyChildren();
      for (const remote of remotes) {
        const { selection, user } = remote.presence;
        for (const nodeId of selection) {
          const node = this.editor.scene.getNode(nodeId);
          if (!node || !node.visible) continue;
          const aabb = getNodeAABB(node);
          this.remoteSelectionsGroup.add(
            new Konva.Rect({
              x: aabb.minX,
              y: aabb.minY,
              width: Math.max(1, aabb.maxX - aabb.minX),
              height: Math.max(1, aabb.maxY - aabb.minY),
              stroke: user.color,
              strokeWidth: 1.5,
              listening: false,
            }),
          );
          const tagWidth = Math.max(40, user.name.length * 7 + 12);
          this.remoteSelectionsGroup.add(
            new Konva.Rect({
              x: aabb.minX,
              y: aabb.minY - 18,
              width: tagWidth,
              height: 16,
              cornerRadius: 4,
              fill: user.color,
              listening: false,
            }),
          );
          this.remoteSelectionsGroup.add(
            new Konva.Text({
              x: aabb.minX + 6,
              y: aabb.minY - 16,
              text: user.name,
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
              fill: '#0B0C0F',
              listening: false,
            }),
          );
        }
      }
    }

    // 2. Track target positions for 60fps cursor lerp
    const seenClientIds = new Set<number>();
    for (const remote of remotes) {
      if (!remote.presence.cursor) continue;
      seenClientIds.add(remote.clientId);
      const existing = this.cursorStates.get(remote.clientId);
      if (existing) {
        existing.target = remote.presence.cursor;
        existing.name = remote.presence.user.name;
        existing.color = remote.presence.user.color;
      } else {
        this.cursorStates.set(remote.clientId, {
          current: { ...remote.presence.cursor },
          target: { ...remote.presence.cursor },
          name: remote.presence.user.name,
          color: remote.presence.user.color,
        });
      }
    }
    for (const clientId of Array.from(this.cursorStates.keys())) {
      if (!seenClientIds.has(clientId)) {
        this.cursorStates.delete(clientId);
      }
    }

    this.syncTransient();
    this.ensureCursorAnimationLoop();
  }

  private ensureCursorAnimationLoop(): void {
    if (this.destroyed || this.rafHandle !== null) return;
    if (this.cursorStates.size === 0) {
      this.drawRemoteCursors();
      return;
    }

    const tick = () => {
      if (this.destroyed) {
        this.rafHandle = null;
        return;
      }
      let needsAnotherFrame = false;
      for (const state of this.cursorStates.values()) {
        const dx = state.target.x - state.current.x;
        const dy = state.target.y - state.current.y;
        if (Math.hypot(dx, dy) < 0.25) {
          state.current = { ...state.target };
        } else {
          state.current.x += dx * 0.35;
          state.current.y += dy * 0.35;
          needsAnotherFrame = true;
        }
      }
      this.drawRemoteCursors();
      if (needsAnotherFrame && typeof globalThis.requestAnimationFrame === 'function') {
        this.rafHandle = globalThis.requestAnimationFrame(tick);
      } else {
        this.rafHandle = null;
      }
    };

    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.rafHandle = globalThis.requestAnimationFrame(tick);
    } else {
      for (const state of this.cursorStates.values()) {
        state.current = { ...state.target };
      }
      this.drawRemoteCursors();
    }
  }

  private drawRemoteCursors(): void {
    if (!this.remoteCursorsGroup) return;
    this.remoteCursorsGroup.destroyChildren();

    for (const [clientId, state] of this.cursorStates) {
      const screen = this.editor.viewport.worldToScreen(state.current);
      const group = new Konva.Group({
        id: `remote-cursor-${clientId}`,
        x: screen.x,
        y: screen.y,
        listening: false,
      });

      group.add(
        new Konva.Line({
          points: [0, 0, 0, 14, 4, 11, 8, 17, 10, 16, 6, 10, 11, 10],
          closed: true,
          fill: state.color,
          stroke: '#0B0C0F',
          strokeWidth: 1,
        }),
      );

      const labelWidth = Math.max(40, state.name.length * 7 + 12);
      group.add(
        new Konva.Rect({
          x: 12,
          y: 12,
          width: labelWidth,
          height: 20,
          cornerRadius: 6,
          fill: state.color,
        }),
      );
      group.add(
        new Konva.Text({
          x: 18,
          y: 16,
          text: state.name,
          fontSize: 11,
          fontFamily: 'Inter, sans-serif',
          fontStyle: '600',
          fill: '#0B0C0F',
        }),
      );

      this.remoteCursorsGroup.add(group);
    }

    this.overlayLayer?.batchDraw();
  }

  private commitTransformerChanges(): void {
    if (!this.transformer || this.editor.commands.isReadOnly()) return;
    const patches: Array<{ id: string; patch: Partial<CanvasNode> }> = [];

    for (const shape of this.transformer.nodes()) {
      const id = shape.id();
      const node = this.editor.scene.getNode(id);
      if (!node) continue;

      const scaleX = shape.scaleX();
      const scaleY = shape.scaleY();
      const nextWidth = Math.max(4, Math.round(node.width * scaleX));
      const nextHeight = Math.max(node.type === 'line' ? 0 : 4, Math.round(node.height * scaleY));
      const nextX = Math.round(shape.x());
      const nextY = Math.round(shape.y());
      const nextRotation = Math.round(shape.rotation() * 100) / 100;

      shape.scaleX(1);
      shape.scaleY(1);

      const patch: Partial<CanvasNode> = {
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
        rotation: nextRotation,
      };
      if (node.type === 'line' && node.points) {
        patch.points = node.points.map((v, idx) =>
          idx % 2 === 0 ? Math.round(v * scaleX) : Math.round(v * scaleY),
        );
      }
      patches.push({ id, patch });
    }

    if (patches.length > 0) {
      this.editor.history.stopCapturing();
      this.editor.commands.execute({ type: 'updateNodes', patches });
      this.editor.history.stopCapturing();
    }
  }

  private bindDomEvents(el: HTMLElement): void {
    const toLocalCoords = (e: PointerEvent | MouseEvent | WheelEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      const pt = toLocalCoords(e);
      if (this.stage) {
        const hit = this.stage.getIntersection(pt);
        if (hit && hit.getParent()?.className === 'Transformer') {
          return;
        }
      }
      this.pointerCaptureActive = true;
      el.setPointerCapture?.(e.pointerId);
      this.editor.tools.handlePointerDown({
        x: pt.x,
        y: pt.y,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      const pt = toLocalCoords(e);
      this.editor.tools.handlePointerMove({
        x: pt.x,
        y: pt.y,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.pointerCaptureActive) return;
      this.pointerCaptureActive = false;
      el.releasePointerCapture?.(e.pointerId);
      const pt = toLocalCoords(e);
      this.editor.tools.handlePointerUp({
        x: pt.x,
        y: pt.y,
        button: e.button,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      });
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (this.editor.commands.isReadOnly()) return;
      const pt = toLocalCoords(e);
      const hitId = this.hitTest(pt);
      if (!hitId) return;
      const node = this.editor.scene.getNode(hitId);
      if (node && node.type === 'text' && this.onTextEditRequested) {
        const screen = this.editor.viewport.worldToScreen({ x: node.x, y: node.y });
        const zoom = this.editor.viewport.getState().zoom;
        this.onTextEditRequested(node, {
          x: screen.x,
          y: screen.y,
          width: Math.max(80, node.width * zoom),
          height: Math.max(32, node.height * zoom),
        });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = toLocalCoords(e);
      if (e.ctrlKey || e.metaKey) {
        const vp = this.editor.viewport.getState();
        const factor = Math.exp(-e.deltaY * 0.002);
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
        this.editor.viewport.zoomAt(nextZoom, pt);
      } else {
        this.editor.viewport.panBy(-e.deltaX, -e.deltaY);
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('wheel', onWheel, { passive: false });

    this.unsubs.push(() => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('wheel', onWheel);
    });
  }

  private bindResizeObserver(el: HTMLElement): void {
    if (typeof globalThis.ResizeObserver !== 'function') return;
    this.resizeObserver = new globalThis.ResizeObserver((entries) => {
      if (!this.stage) return;
      const rect = entries[0]?.contentRect;
      const w = Math.max(1, Math.round(rect?.width ?? el.clientWidth));
      const h = Math.max(1, Math.round(rect?.height ?? el.clientHeight));
      this.stage.size({ width: w, height: h });
      this.bgLayer?.batchDraw();
      this.sceneLayer?.batchDraw();
      this.overlayLayer?.batchDraw();
    });
    this.resizeObserver.observe(el);
  }
}
