import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CommandBus } from '../src/commands/commands.js';
import {
  createInitialDoc,
  getDocRoots,
  LOCAL_ORIGIN,
  readAllNodesSorted,
  serializeDocSnapshot,
} from '../src/model/doc.js';
import { generateJitteredKeyBetween } from '../src/model/indexing.js';
import { SceneGraph, type SceneDiff } from '../src/scene/scene-graph.js';
import { createPeers, createPrng, makePeerPair } from './peers.js';

describe('editor-core commands, scene diff, and CRDT convergence', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  it('executes all 12 commands cleanly and emits incremental SceneDiff', () => {
    const doc = createInitialDoc({ title: 'Cmd Test', clientId: 77 });
    const bus = new CommandBus(doc, 'user-1');
    const scene = new SceneGraph(doc);
    cleanups.push(() => {
      scene.destroy();
      doc.destroy();
    });

    const diffs: SceneDiff[] = [];
    scene.subscribe((d) => diffs.push(d));

    // createNode across shape types
    const r1 = bus.execute({
      type: 'createNode',
      input: { id: 'r1', type: 'rect', x: 10, y: 20, width: 100, height: 50 },
    });
    const r2 = bus.execute({
      type: 'createNode',
      input: { id: 'r2', type: 'ellipse', x: 200, y: 80, width: 60, height: 60 },
    });
    const r3 = bus.execute({
      type: 'createNode',
      input: { id: 'r3', type: 'rect', x: 410, y: 140, width: 80, height: 40 },
    });
    const t1 = bus.execute({
      type: 'createNode',
      input: { id: 't1', type: 'text', x: 50, y: 300, text: 'Hello' },
    });
    expect([r1.createdIds[0], r2.createdIds[0], r3.createdIds[0], t1.createdIds[0]]).toEqual([
      'r1',
      'r2',
      'r3',
      't1',
    ]);
    expect(diffs[0]?.added.map((n) => n.id)).toEqual(['r1']);
    expect(diffs[0]?.orderChanged).toBe(true);

    // updateNodes emits exact changedKeys without orderChanged when index/parent untouched
    bus.execute({
      type: 'updateNodes',
      patches: [{ id: 'r1', patch: { fill: '#FF0000' } }],
    });
    const patchDiff = diffs[diffs.length - 1]!;
    expect(patchDiff.updated[0]?.node.fill).toBe('#FF0000');
    expect(patchDiff.updated[0]?.changedKeys).toContain('fill');
    expect(patchDiff.orderChanged).toBe(false);

    // moveNodes
    bus.execute({ type: 'moveNodes', ids: ['r1'], dx: 15, dy: -5 });
    expect(scene.getNode('r1')?.x).toBe(25);
    expect(scene.getNode('r1')?.y).toBe(15);

    // reorder before r1
    bus.execute({ type: 'reorder', nodeId: 'r3', beforeId: 'r1' });
    const orderedIds = scene.getChildren(null).map((n) => n.id);
    expect(orderedIds.indexOf('r3')).toBeLessThan(orderedIds.indexOf('r1'));

    // alignNodes & distributeNodes
    bus.execute({ type: 'alignNodes', ids: ['r1', 'r2', 'r3'], mode: 'top' });
    expect(scene.getNode('r1')?.y).toBe(15);
    expect(scene.getNode('r2')?.y).toBe(15);
    expect(scene.getNode('r3')?.y).toBe(15);

    bus.execute({ type: 'distributeNodes', ids: ['r1', 'r2', 'r3'], axis: 'horizontal' });
    const sortedX = [scene.getNode('r1')!, scene.getNode('r2')!, scene.getNode('r3')!].sort(
      (a, b) => a.x - b.x,
    );
    const gap1 = sortedX[1]!.x - (sortedX[0]!.x + sortedX[0]!.width);
    const gap2 = sortedX[2]!.x - (sortedX[1]!.x + sortedX[1]!.width);
    expect(gap1).toBeCloseTo(gap2, 4);

    // group & moveNodes on group moves children in world coords too
    const grp = bus.execute({ type: 'group', ids: ['r1', 'r2'], groupId: 'g1', name: 'Shapes' });
    expect(grp.createdIds).toEqual(['g1']);
    expect(scene.getNode('r1')?.parentId).toBe('g1');
    const r1BeforeGroupMove = scene.getNode('r1')!.x;
    bus.execute({ type: 'moveNodes', ids: ['g1'], dx: 50, dy: 25 });
    expect(scene.getNode('g1')?.x).toBeGreaterThan(0);
    expect(scene.getNode('r1')?.x).toBe(r1BeforeGroupMove + 50);

    // duplicate group clones group + children with remapped parentId
    const dup = bus.execute({ type: 'duplicate', ids: ['g1'], offset: { x: 100, y: 100 } });
    expect(dup.createdIds).toContain('g1' === dup.createdIds[0] ? 'never' : dup.createdIds[0]);
    const clonedChildren = scene.getChildren(dup.createdIds[0]!);
    expect(clonedChildren).toHaveLength(2);

    // ungroup restores children to top-level and removes group
    bus.execute({ type: 'ungroup', id: 'g1' });
    expect(scene.getNode('g1')).toBeUndefined();
    expect(scene.getNode('r1')?.parentId).toBeNull();

    // setText & editText
    bus.execute({ type: 'setText', nodeId: 't1', text: 'Nova Studio' });
    expect(scene.getNode('t1')?.text).toBe('Nova Studio');
    bus.execute({ type: 'editText', nodeId: 't1', index: 4, deleteCount: 0, insertText: ' 2026' });
    expect(scene.getNode('t1')?.text).toBe('Nova 2026 Studio');

    // pasteNodes
    const snapshot = [scene.getNode('r1')!, scene.getNode('t1')!];
    const pasted = bus.execute({ type: 'pasteNodes', nodes: snapshot, offset: { x: 30, y: 30 } });
    expect(pasted.createdIds).toHaveLength(2);

    // deleteNodes
    const delRes = bus.execute({ type: 'deleteNodes', ids: ['r3', ...dup.createdIds] });
    expect(delRes.deletedIds).toContain('r3');
    expect(scene.getNode('r3')).toBeUndefined();
  });

  it('ignores mutations when CommandBus is readOnly and skips corrupt nodes safely', () => {
    const doc = createInitialDoc();
    const bus = new CommandBus(doc, 'viewer-1', { readOnly: true });
    const scene = new SceneGraph(doc);
    cleanups.push(() => {
      scene.destroy();
      doc.destroy();
    });

    const res = bus.execute({ type: 'createNode', input: { type: 'rect' } });
    expect(res.createdIds).toHaveLength(0);
    expect(scene.getAllNodes()).toHaveLength(0);

    // Corrupt raw Y.Map missing required fields
    doc.transact(() => {
      const bad = new Y.Map<unknown>();
      bad.set('id', 'corrupt');
      getDocRoots(doc).nodes.set('corrupt', bad);
    });
    expect(readAllNodesSorted(doc)).toHaveLength(0);
  });

  it('Conflict 1: A changes fill and B changes x on same node -> both preserved', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({ type: 'createNode', input: { id: 'n1', type: 'rect', x: 10, y: 10 } });
    network.flushAll();

    // Concurrent edits before syncing
    a.bus.execute({ type: 'updateNodes', patches: [{ id: 'n1', patch: { fill: '#EF4444' } }] });
    b.bus.execute({ type: 'updateNodes', patches: [{ id: 'n1', patch: { x: 250 } }] });
    network.flushAll();

    expect(snapshotA()).toEqual(snapshotB());
    expect(a.scene.getNode('n1')?.fill).toBe('#EF4444');
    expect(a.scene.getNode('n1')?.x).toBe(250);
  });

  it('Conflict 2: A and B concurrently edit same field (fill) -> consistent LWW convergence', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({ type: 'createNode', input: { id: 'n1', type: 'rect', fill: '#000000' } });
    network.flushAll();

    a.bus.execute({ type: 'updateNodes', patches: [{ id: 'n1', patch: { fill: '#111111' } }] });
    b.bus.execute({ type: 'updateNodes', patches: [{ id: 'n1', patch: { fill: '#222222' } }] });
    network.deliverRandomOrder(9);

    expect(snapshotA()).toEqual(snapshotB());
    expect(['#111111', '#222222']).toContain(a.scene.getNode('n1')?.fill);
  });

  it('Conflict 3: A deletes node while B edits it -> deleted on both, B observes remote removal', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({
      type: 'createNode',
      input: { id: 'victim', type: 'rect', name: 'Hero Banner', x: 10, y: 10 },
    });
    network.flushAll();

    const remoteRemovals: Array<{ ids: string[]; isRemote: boolean; names: string[] }> = [];
    b.scene.subscribe((diff, meta) => {
      if (diff.removed.length > 0) {
        remoteRemovals.push({
          ids: diff.removed,
          isRemote: meta.origin !== LOCAL_ORIGIN,
          names: meta.removedNodes.map((n) => n.name),
        });
      }
    });

    a.bus.execute({ type: 'deleteNodes', ids: ['victim'] });
    b.bus.execute({ type: 'updateNodes', patches: [{ id: 'victim', patch: { x: 99 } }] });
    network.flushAll();

    expect(snapshotA()).toEqual(snapshotB());
    expect(a.scene.getNode('victim')).toBeUndefined();
    expect(b.scene.getNode('victim')).toBeUndefined();
    expect(remoteRemovals).toEqual([
      { ids: ['victim'], isRemote: true, names: ['Hero Banner'] },
    ]);
  });

  it('Conflict 4: A and B concurrently reorder into same slot -> jitter prevents index collision', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({ type: 'createNode', input: { id: 'first', type: 'rect' } });
    a.bus.execute({ type: 'createNode', input: { id: 'last', type: 'rect' } });
    a.bus.execute({ type: 'createNode', input: { id: 'moveA', type: 'rect' } });
    a.bus.execute({ type: 'createNode', input: { id: 'moveB', type: 'rect' } });
    network.flushAll();

    a.bus.execute({ type: 'reorder', nodeId: 'moveA', afterId: 'first', beforeId: 'last' });
    b.bus.execute({ type: 'reorder', nodeId: 'moveB', afterId: 'first', beforeId: 'last' });
    network.flushAll();

    expect(snapshotA()).toEqual(snapshotB());
    const idxA = a.scene.getNode('moveA')?.index;
    const idxB = a.scene.getNode('moveB')?.index;
    expect(idxA).toBeDefined();
    expect(idxB).toBeDefined();
    expect(idxA).not.toBe(idxB);

    // Verify key generator handles inverted bounds safely (both valid keys and malformed inputs)
    const recovered = generateJitteredKeyBetween('a1', 'a0', 123);
    expect(recovered > 'a1').toBe(true);
    expect(typeof generateJitteredKeyBetween('b0', 'a0', 123)).toBe('string');
  });

  it('Conflict 5: A and B type concurrently into Y.Text -> both character insertions survive', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({
      type: 'createNode',
      input: { id: 'txt', type: 'text', text: 'Hello World' },
    });
    network.flushAll();

    a.bus.execute({ type: 'editText', nodeId: 'txt', index: 5, deleteCount: 0, insertText: ' Collaborative' });
    b.bus.execute({ type: 'editText', nodeId: 'txt', index: 11, deleteCount: 0, insertText: '!' });
    network.deliverRandomOrder(17);

    expect(snapshotA()).toEqual(snapshotB());
    const mergedText = a.scene.getNode('txt')?.text ?? '';
    expect(mergedText).toContain('Collaborative');
    expect(mergedText).toContain('!');
    expect(mergedText).toBe('Hello Collaborative World!');
  });

  it('Conflict 6 & 7: A works offline while B edits concurrently -> resume merges without loss', () => {
    const { a, b, network, snapshotA, snapshotB } = makePeerPair();
    cleanups.push(() => network.destroy());

    a.bus.execute({ type: 'createNode', input: { id: 'shared', type: 'rect', x: 0, y: 0 } });
    network.flushAll();

    network.pause(0);
    a.bus.execute({ type: 'createNode', input: { id: 'offline-node', type: 'ellipse', x: 50, y: 50 } });
    a.bus.execute({ type: 'updateNodes', patches: [{ id: 'shared', patch: { opacity: 0.5 } }] });

    b.bus.execute({ type: 'createNode', input: { id: 'online-node', type: 'rect', x: 150, y: 150 } });
    b.bus.execute({ type: 'updateNodes', patches: [{ id: 'shared', patch: { rotation: 45 } }] });

    expect(a.scene.getNode('online-node')).toBeUndefined();
    expect(b.scene.getNode('offline-node')).toBeUndefined();

    network.resume(0);

    expect(snapshotA()).toEqual(snapshotB());
    expect(a.scene.getNode('offline-node')).toBeDefined();
    expect(a.scene.getNode('online-node')).toBeDefined();
    expect(b.scene.getNode('shared')?.opacity).toBe(0.5);
    expect(b.scene.getNode('shared')?.rotation).toBe(45);
  });

  it('converges across 3 peers after 200 randomized operations delivered in random order', () => {
    const net = createPeers(3, { title: 'Property Test' });
    cleanups.push(() => net.destroy());
    const rng = createPrng(20261114);

    // Seed initial nodes so early ops always have targets
    for (let i = 0; i < 6; i += 1) {
      const p = net.peers[i % 3]!;
      p.bus.execute({
        type: 'createNode',
        input: {
          type: i % 2 === 0 ? 'rect' : 'text',
          x: i * 40,
          y: i * 30,
          width: 80,
          height: 50,
          text: i % 2 === 1 ? 'Seed' : undefined,
        },
      });
    }
    net.flushAll();

    for (let step = 0; step < 200; step += 1) {
      const peer = net.peers[Math.floor(rng() * net.peers.length)]!;
      const all = peer.scene.getAllNodes().filter((n) => n.type !== 'group');
      const opKind = Math.floor(rng() * 7);

      if (opKind === 0 || all.length < 3) {
        peer.bus.execute({
          type: 'createNode',
          input: {
            type: rng() > 0.5 ? 'rect' : 'text',
            x: Math.floor(rng() * 500),
            y: Math.floor(rng() * 500),
            width: 50 + Math.floor(rng() * 100),
            height: 40 + Math.floor(rng() * 80),
            text: 'Item',
          },
        });
      } else if (opKind === 1) {
        const target = all[Math.floor(rng() * all.length)]!;
        peer.bus.execute({
          type: 'updateNodes',
          patches: [
            {
              id: target.id,
              patch: {
                fill: rng() > 0.5 ? '#60A5FA' : '#F472B6',
                rotation: Math.floor(rng() * 180),
              },
            },
          ],
        });
      } else if (opKind === 2) {
        const target = all[Math.floor(rng() * all.length)]!;
        peer.bus.execute({
          type: 'moveNodes',
          ids: [target.id],
          dx: Math.floor(rng() * 40) - 20,
          dy: Math.floor(rng() * 40) - 20,
        });
      } else if (opKind === 3 && all.length >= 2) {
        const target = all[Math.floor(rng() * all.length)]!;
        const neighbor = all[Math.floor(rng() * all.length)]!;
        if (target.id !== neighbor.id && target.parentId === neighbor.parentId) {
          peer.bus.execute({ type: 'reorder', nodeId: target.id, beforeId: neighbor.id });
        }
      } else if (opKind === 4) {
        const textNodes = all.filter((n) => n.type === 'text');
        if (textNodes.length > 0) {
          const target = textNodes[Math.floor(rng() * textNodes.length)]!;
          peer.bus.execute({
            type: 'editText',
            nodeId: target.id,
            index: 0,
            deleteCount: 0,
            insertText: 'a',
          });
        }
      } else if (opKind === 5 && all.length >= 2) {
        const a = all[Math.floor(rng() * all.length)]!;
        const b = all[Math.floor(rng() * all.length)]!;
        if (a.id !== b.id && a.parentId === b.parentId) {
          peer.bus.execute({ type: 'alignNodes', ids: [a.id, b.id], mode: 'left' });
        }
      } else if (all.length > 8) {
        const target = all[Math.floor(rng() * all.length)]!;
        peer.bus.execute({ type: 'deleteNodes', ids: [target.id] });
      }

      // Periodically deliver packets in random order between batches
      if (step % 15 === 0) {
        net.deliverRandomOrder(step + 1);
      }
    }

    net.deliverRandomOrder(9999);
    net.flushAll();

    const s0 = serializeDocSnapshot(net.peers[0]!.doc);
    const s1 = serializeDocSnapshot(net.peers[1]!.doc);
    const s2 = serializeDocSnapshot(net.peers[2]!.doc);

    expect(s1).toEqual(s0);
    expect(s2).toEqual(s0);
    expect(Y.encodeStateVector(net.peers[1]!.doc)).toEqual(Y.encodeStateVector(net.peers[0]!.doc));
    expect(Y.encodeStateVector(net.peers[2]!.doc)).toEqual(Y.encodeStateVector(net.peers[0]!.doc));
  });
});
