import { DEFAULT_PAGE_ID } from '@nova/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import {
  aabbIntersects,
  aabbToRect,
  ClipboardManager,
  computeResizedBounds,
  computeRotationAngle,
  computeSnap,
  createDefaultNode,
  createInitialDoc,
  Editor,
  getNodeAABB,
  mergeAABBs,
  pointInNode,
  PresenceManager,
  rectToAABB,
  RESTORE_ORIGIN,
  rotatePointAround,
  SceneGraph,
  SpatialIndex,
  ViewportStore,
} from '../src/index.js';

describe('editor-core Part 2: geometry, spatial index, snapping, tools, history, presence & Editor', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  it('computes geometry, rotation AABBs, pointInNode, resize with Shift lock, and angle snap', () => {
    const pt = rotatePointAround({ x: 100, y: 0 }, { x: 0, y: 0 }, 90);
    expect(pt.x).toBeCloseTo(0, 5);
    expect(pt.y).toBeCloseTo(100, 5);

    const rectNode = createDefaultNode({
      id: 'rect-1',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 90,
      index: 'a0',
      createdBy: 'u1',
    });
    const rotBox = getNodeAABB(rectNode);
    expect(rotBox.minX).toBeCloseTo(-40, 4);
    expect(rotBox.maxX).toBeCloseTo(10, 4);
    expect(rotBox.minY).toBeCloseTo(20, 4);
    expect(rotBox.maxY).toBeCloseTo(120, 4);
    expect(pointInNode({ x: -10, y: 60 }, rectNode)).toBe(true);
    expect(pointInNode({ x: 50, y: 60 }, rectNode)).toBe(false);

    const ellipseNode = createDefaultNode({
      id: 'el-1',
      type: 'ellipse',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      index: 'a1',
      createdBy: 'u1',
    });
    expect(pointInNode({ x: 50, y: 50 }, ellipseNode)).toBe(true);
    expect(pointInNode({ x: 2, y: 2 }, ellipseNode)).toBe(false);

    const lineNode = createDefaultNode({
      id: 'ln-1',
      type: 'line',
      x: 10,
      y: 10,
      width: 100,
      height: 0,
      points: [0, 0, 100, 0],
      index: 'a2',
      createdBy: 'u1',
    });
    const lineBox = getNodeAABB(lineNode);
    expect(lineBox.minX).toBeLessThanOrEqual(10);
    expect(lineBox.maxX).toBeGreaterThanOrEqual(110);
    expect(pointInNode({ x: 60, y: 12 }, lineNode, 4)).toBe(true);
    expect(pointInNode({ x: 60, y: 30 }, lineNode, 4)).toBe(false);

    const invisible = { ...rectNode, visible: false };
    expect(pointInNode({ x: -10, y: 60 }, invisible)).toBe(false);

    // Resize nw with preserveAspect=true locks 2:1 ratio and clamps minSize
    const resized = computeResizedBounds({
      initial: { x: 100, y: 100, width: 200, height: 100 },
      handle: 'se',
      dx: 100,
      dy: 10,
      preserveAspect: true,
    });
    expect(resized.width).toBe(300);
    expect(resized.height).toBe(150);

    const clamped = computeResizedBounds({
      initial: { x: 100, y: 100, width: 50, height: 50 },
      handle: 'nw',
      dx: 100,
      dy: 100,
      minSize: 8,
    });
    expect(clamped.width).toBe(8);
    expect(clamped.height).toBe(8);

    expect(computeRotationAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(90, 4);
    expect(computeRotationAngle({ x: 0, y: 0 }, { x: 98, y: 10 }, 15)).toBe(90);

    const merged = mergeAABBs([
      rectToAABB({ x: 0, y: 0, width: 10, height: 10 }),
      rectToAABB({ x: 20, y: 20, width: 10, height: 10 }),
    ]);
    expect(aabbToRect(merged!)).toEqual({ x: 0, y: 0, width: 30, height: 30 });
    expect(aabbIntersects(rectToAABB({ x: 0, y: 0, width: 10, height: 10 }), merged!)).toBe(true);
    expect(mergeAABBs([])).toBeNull();
  });

  it('snaps within 6px screen threshold scaled by zoom and falls back to grid snap', () => {
    const target = createDefaultNode({
      id: 'snap-target',
      type: 'rect',
      x: 200,
      y: 300,
      width: 100,
      height: 100,
      index: 'a0',
      createdBy: 'u1',
    });

    // Zoom 2x => 6px screen threshold = 3 world units
    const withinSnap = computeSnap({
      movingIds: new Set(['mover']),
      proposedRect: { x: 198, y: 349, width: 50, height: 50 },
      candidates: [target],
      zoom: 2,
    });
    expect(withinSnap.snappedX).toBe(true);
    expect(withinSnap.dx).toBe(2); // aligns left edge to 200
    expect(withinSnap.guides.some((g) => g.orientation === 'vertical' && g.position === 200)).toBe(
      true,
    );

    const outsideSnap = computeSnap({
      movingIds: new Set(['mover']),
      proposedRect: { x: 195, y: 340, width: 50, height: 50 },
      candidates: [target],
      zoom: 2,
    });
    expect(outsideSnap.snappedX).toBe(false);

    const gridSnap = computeSnap({
      movingIds: new Set(['mover']),
      proposedRect: { x: 22, y: 39, width: 50, height: 50 },
      candidates: [],
      zoom: 1,
      gridSize: 10,
    });
    expect(gridSnap.snappedX).toBe(true);
    expect(gridSnap.dx).toBe(-2);
    expect(gridSnap.snappedY).toBe(true);
    expect(gridSnap.dy).toBe(1);
  });

  it('hits topmost visible unlocked node in rbush SpatialIndex across 300+ nodes', () => {
    const doc = createInitialDoc();
    const scene = new SceneGraph(doc);
    const index = new SpatialIndex();
    cleanups.push(() => {
      index.clear();
      scene.destroy();
      doc.destroy();
    });

    const nodes = [];
    for (let i = 0; i < 300; i += 1) {
      nodes.push(
        createDefaultNode({
          id: `n-${i}`,
          type: 'rect',
          x: i * 10,
          y: 0,
          width: 40,
          height: 40,
          index: `a${String(i).padStart(4, '1')}`,
          createdBy: 'u1',
        }),
      );
    }
    const bottom = createDefaultNode({
      id: 'bottom',
      type: 'rect',
      x: 100,
      y: 100,
      width: 80,
      height: 80,
      index: 'z0',
      createdBy: 'u1',
    });
    const topLocked = createDefaultNode({
      id: 'top-locked',
      type: 'rect',
      x: 100,
      y: 100,
      width: 80,
      height: 80,
      locked: true,
      index: 'z2',
      createdBy: 'u1',
    });
    const topUnlocked = createDefaultNode({
      id: 'top-unlocked',
      type: 'rect',
      x: 100,
      y: 100,
      width: 80,
      height: 80,
      index: 'z1',
      createdBy: 'u1',
    });

    const all = [...nodes, bottom, topUnlocked, topLocked];
    index.rebuild(all);
    expect(index.searchRect({ x: 95, y: 95, width: 20, height: 20 })).toContain('top-unlocked');

    // Verify full hit-test through real Editor + SceneGraph
    const editor = new Editor({ doc, userId: 'u1' });
    cleanups.push(() => editor.destroy());
    editor.commands.execute({ type: 'createNode', input: { id: 'under', type: 'rect', x: 100, y: 100, width: 80, height: 80 } });
    editor.commands.execute({ type: 'createNode', input: { id: 'over', type: 'rect', x: 100, y: 100, width: 80, height: 80 } });
    editor.commands.execute({ type: 'createNode', input: { id: 'locked', type: 'rect', x: 100, y: 100, width: 80, height: 80, locked: true } });

    const hit = editor.spatialIndex.hitTestPoint({ x: 120, y: 120 }, editor.scene, {
      pageId: DEFAULT_PAGE_ID,
    });
    expect(hit?.id).toBe('over');
  });

  it('preserves screen-anchor invariant on zoomAt and fits nodes in ViewportStore', () => {
    const vp = new ViewportStore({ x: 0, y: 0, zoom: 1 });
    cleanups.push(() => vp.destroy());

    const anchor = { x: 400, y: 300 };
    const worldBefore = vp.screenToWorld(anchor);
    vp.zoomAt(2.5, anchor);
    const worldAfter = vp.screenToWorld(anchor);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);

    const screenBack = vp.worldToScreen(worldAfter);
    expect(screenBack.x).toBeCloseTo(anchor.x, 5);
    expect(screenBack.y).toBeCloseTo(anchor.y, 5);

    const box = createDefaultNode({
      id: 'b1',
      type: 'rect',
      x: 500,
      y: 400,
      width: 200,
      height: 100,
      index: 'a0',
      createdBy: 'u1',
    });
    vp.fitToNodes([box], { width: 800, height: 600 }, 40);
    expect(vp.getState().zoom).toBeCloseTo(2, 3);
    vp.zoomTo100();
    expect(vp.getState().zoom).toBe(1);
  });

  it('throttles PresenceManager cursors at 30Hz, hides after 10s idle, and syncs remote peers', () => {
    vi.useFakeTimers();

    const docA = createInitialDoc({ clientId: 11 });
    const docB = createInitialDoc({ clientId: 22 });
    const awA = new Awareness(docA);
    const awB = new Awareness(docB);
    cleanups.push(() => {
      awA.destroy();
      awB.destroy();
      docA.destroy();
      docB.destroy();
    });

    awA.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const msg = encodeAwarenessUpdate(awA, [...added, ...updated, ...removed]);
      applyAwarenessUpdate(awB, msg, 'sync');
    });

    const pA = new PresenceManager({
      userId: 'alice',
      userName: 'Alice',
      awareness: awA,
      cursorThrottleMs: 33,
      cursorIdleMs: 10_000,
    });
    const pB = new PresenceManager({
      userId: 'bob',
      userName: 'Bob',
      awareness: awB,
    });
    cleanups.push(() => {
      pA.destroy();
      pB.destroy();
    });

    pA.setCursor({ x: 10, y: 20 });
    pA.setCursor({ x: 15, y: 25 }); // throttled
    pA.setCursor({ x: 40, y: 60 }); // trailing update wins

    expect(pB.getRemotePresences()[0]?.presence.cursor).toEqual({ x: 10, y: 20 });

    vi.advanceTimersByTime(40);
    expect(pB.getRemotePresences()[0]?.presence.cursor).toEqual({ x: 40, y: 60 });

    vi.advanceTimersByTime(10_000);
    expect(pB.getRemotePresences()[0]?.presence.cursor).toBeNull();
  });

  it('handles ClipboardManager round-trip and rejects malformed payloads', () => {
    const clip = new ClipboardManager();
    const node = createDefaultNode({
      id: 'c1',
      type: 'rect',
      x: 10,
      y: 20,
      width: 50,
      height: 50,
      index: 'a0',
      createdBy: 'u1',
    });

    expect(clip.hasContent()).toBe(false);
    const raw = clip.copy([node]);
    expect(clip.hasContent()).toBe(true);
    expect(ClipboardManager.parseSerializedNodes(raw)).toHaveLength(1);
    expect(ClipboardManager.parseSerializedNodes('{invalid')).toBeNull();
    expect(ClipboardManager.parseSerializedNodes('{"kind":"other"}')).toBeNull();

    expect(clip.readInternal()?.offset).toEqual({ x: 20, y: 20 });
    expect(clip.readInternal()?.offset).toEqual({ x: 40, y: 40 });
  });

  it('drives ToolManager FSM for shape draw, snap-drag, marquee, hand pan, and shortcuts', () => {
    const doc = createInitialDoc({ clientId: 5 });
    const aw = new Awareness(doc);
    const editor = new Editor({ doc, userId: 'u1', userName: 'Alice', awareness: aw });
    cleanups.push(() => {
      editor.destroy();
      aw.destroy();
      doc.destroy();
    });

    const textEdits: string[] = [];
    editor.subscribe('textEditRequested', ({ nodeId }) => textEdits.push(nodeId));

    // Draw a 1:1 rectangle with R shortcut + Shift square lock
    editor.tools.handleKeyDown({ key: 'r' });
    expect(editor.tools.getActiveTool()).toBe('rect');
    editor.tools.handlePointerDown({ x: 100, y: 100 });
    editor.tools.handlePointerMove({ x: 200, y: 140, shiftKey: true });
    expect(editor.tools.getDraftShape()?.width).toBe(100);
    expect(editor.tools.getDraftShape()?.height).toBe(100);
    editor.tools.handlePointerUp({ x: 200, y: 140, shiftKey: true });

    const rectId = editor.selection.getIds()[0]!;
    expect(editor.scene.getNode(rectId)?.width).toBe(100);
    expect(editor.tools.getActiveTool()).toBe('select');

    // Draw text node by single click (places default size and requests inline text edit)
    editor.tools.handleKeyDown({ key: 't' });
    editor.tools.handlePointerDown({ x: 350, y: 100 });
    editor.tools.handlePointerUp({ x: 350, y: 100 });
    expect(textEdits).toHaveLength(1);

    // Drag rect near x=350 (snap to text left edge within 6px) -> single commit on pointerUp
    let txCount = 0;
    doc.on('afterTransaction', () => {
      txCount += 1;
    });
    editor.tools.handlePointerDown({ x: 120, y: 120 });
    editor.tools.handlePointerMove({ x: 367, y: 120 }); // 100 + 247 = 347 -> snaps 3px to 350!
    expect(txCount).toBe(0); // zero Yjs commits during pointermove
    expect(editor.tools.getDragPreview()?.dx).toBe(250);
    editor.tools.handlePointerUp({ x: 367, y: 120 });
    expect(txCount).toBe(1);
    expect(editor.scene.getNode(rectId)?.x).toBe(350);

    // Spacebar temporary hand pan
    editor.tools.handleKeyDown({ key: ' ', code: 'Space' });
    expect(editor.tools.getActiveTool()).toBe('hand');
    editor.tools.handlePointerDown({ x: 50, y: 50 });
    editor.tools.handlePointerMove({ x: 75, y: 65 });
    editor.tools.handlePointerUp({ x: 75, y: 65 });
    expect(editor.viewport.getState().x).toBe(25);
    expect(editor.viewport.getState().y).toBe(15);
    editor.tools.handleKeyUp({ key: ' ', code: 'Space' });
    expect(editor.tools.getActiveTool()).toBe('select');

    // Keyboard shortcuts: Select All, Duplicate, Copy/Paste, Group/Ungroup, Nudge, Z-order, Delete
    editor.tools.handleKeyDown({ key: '0', metaKey: true });
    expect(editor.viewport.getState().zoom).toBe(1);
    editor.viewport.setState({ x: 0, y: 0, zoom: 1 });

    // Marquee select around rect (x=350,y=100) and text (x=350,y=100)
    editor.tools.handlePointerDown({ x: 340, y: 90 });
    editor.tools.handlePointerMove({ x: 560, y: 210 });
    editor.tools.handlePointerUp({ x: 560, y: 210 });
    expect(editor.selection.getIds().length).toBeGreaterThanOrEqual(2);

    editor.tools.handleKeyDown({ key: 'ArrowRight', shiftKey: true });
    expect(editor.scene.getNode(rectId)?.x).toBe(360);

    editor.tools.handleKeyDown({ key: 'g', metaKey: true });
    const grpId = editor.selection.getIds()[0]!;
    expect(editor.scene.getNode(grpId)?.type).toBe('group');
    editor.tools.handleKeyDown({ key: 'g', metaKey: true, shiftKey: true });
    expect(editor.scene.getNode(grpId)).toBeUndefined();

    editor.tools.handleKeyDown({ key: 'a', metaKey: true });
    const copyRes = editor.tools.handleKeyDown({ key: 'c', metaKey: true });
    expect(copyRes.copiedText).toBeDefined();
    editor.tools.handleKeyDown({ key: 'v', metaKey: true });
    expect(editor.scene.getAllNodes().length).toBe(4);

    editor.tools.handleKeyDown({ key: 'Delete' });
    expect(editor.scene.getAllNodes().length).toBe(2);

    editor.tools.handleKeyDown({ key: 'z', metaKey: true });
    expect(editor.scene.getAllNodes().length).toBe(4);

    // Z-order forward/backward, duplicate, fit, and escape
    editor.selection.set([rectId]);
    editor.tools.handleKeyDown({ key: ']', metaKey: true });
    editor.tools.handleKeyDown({ key: '[', metaKey: true });
    editor.tools.handleKeyDown({ key: 'd', metaKey: true });
    expect(editor.scene.getAllNodes().length).toBe(5);
    const fitRes = editor.tools.handleKeyDown({ key: '!', shiftKey: true });
    expect(fitRes.fitRequested).toBe(true);
    editor.tools.handleKeyDown({ key: 'Escape' });
    expect(editor.selection.getIds()).toEqual([]);

    const dbg = editor.getDebugSnapshot();
    expect(dbg.doc.nodes.length).toBe(5);
  });

  it('2-peer UndoManager reverts ONLY local edits and emits remoteNodeDeleted when selected node is deleted remotely', () => {
    const docA = createInitialDoc({ clientId: 10 });
    const docB = new Y.Doc();
    docB.clientID = 20;

    const sync = (from: Y.Doc, to: Y.Doc) => {
      from.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin !== 'peer-sync') {
          Y.applyUpdate(to, u, 'peer-sync');
        }
      });
    };
    sync(docA, docB);
    sync(docB, docA);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), 'peer-sync');

    const edA = new Editor({ doc: docA, userId: 'alice' });
    const edB = new Editor({ doc: docB, userId: 'bob' });
    cleanups.push(() => {
      edA.destroy();
      edB.destroy();
      docA.destroy();
      docB.destroy();
    });

    const deletedNotifications: string[] = [];
    edA.subscribe('remoteNodeDeleted', ({ ids }) => {
      deletedNotifications.push(...ids);
    });

    // Alice creates nodeA, Bob creates nodeB
    edA.commands.execute({
      type: 'createNode',
      input: { id: 'nodeA', type: 'rect', x: 10, y: 10 },
    });
    edA.history.stopCapturing();
    edB.commands.execute({
      type: 'createNode',
      input: { id: 'nodeB', type: 'ellipse', x: 200, y: 200 },
    });
    edB.history.stopCapturing();

    // Alice updates nodeA; Bob updates nodeB
    edA.commands.execute({
      type: 'updateNodes',
      patches: [{ id: 'nodeA', patch: { fill: '#FF0000' } }],
    });
    edB.commands.execute({
      type: 'updateNodes',
      patches: [{ id: 'nodeB', patch: { fill: '#00FF00' } }],
    });

    // Alice undoes twice -> reverts ONLY nodeA color + creation, leaving Bob's nodeB intact!
    expect(edA.history.undo()).toBe(true);
    expect(edA.scene.getNode('nodeA')?.fill).toBe('#7C5CFF');
    expect(edA.scene.getNode('nodeB')?.fill).toBe('#00FF00');

    expect(edA.history.redo()).toBe(true);
    expect(edA.scene.getNode('nodeA')?.fill).toBe('#FF0000');

    // Alice selects nodeB, Bob deletes nodeB -> Alice drops selection and gets remoteNodeDeleted event
    edA.selection.set(['nodeB']);
    expect(edA.selection.getIds()).toEqual(['nodeB']);

    edB.commands.execute({ type: 'deleteNodes', ids: ['nodeB'] });
    expect(edA.selection.getIds()).toEqual([]);
    expect(deletedNotifications).toEqual(['nodeB']);

    // Restore origin transaction clears local undo stack
    docA.transact(() => {
      // simulate restore mutation
      docA.getMap('meta').set('restoredAt', Date.now());
    }, RESTORE_ORIGIN);
    expect(edA.history.canUndo()).toBe(false);
  });
});
