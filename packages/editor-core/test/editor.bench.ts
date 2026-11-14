import { DEFAULT_PAGE_ID } from '@nova/shared';
import { bench, describe } from 'vitest';
import * as Y from 'yjs';
import {
  CommandBus,
  createDefaultNode,
  createInitialDoc,
  generateSequentialKeys,
  getDocRoots,
  LOCAL_ORIGIN,
  readAllNodesSorted,
  SceneGraph,
  SpatialIndex,
  writeNodeToMap,
} from '../src/index.js';

function populateThousandNodeDoc(): {
  doc: Y.Doc;
  bus: CommandBus;
  scene: SceneGraph;
  index: SpatialIndex;
  nodeIds: string[];
} {
  const doc = createInitialDoc({ clientId: 1 });
  const keys = generateSequentialKeys(null, null, 1000, doc.clientID);
  const nodeIds: string[] = [];

  doc.transact(() => {
    const { nodes } = getDocRoots(doc);
    for (let i = 0; i < 1000; i += 1) {
      const id = `bench-node-${i}`;
      nodeIds.push(id);
      const col = i % 32;
      const row = Math.floor(i / 32);
      const node = createDefaultNode({
        id,
        type: i % 5 === 0 ? 'ellipse' : 'rect',
        pageId: DEFAULT_PAGE_ID,
        name: `Node ${i}`,
        x: col * 80,
        y: row * 80,
        width: 64,
        height: 48,
        index: keys[i]!,
        createdBy: 'bench-user',
      });
      const nodeMap = new Y.Map<unknown>();
      nodes.set(id, nodeMap);
      writeNodeToMap(nodeMap, node);
    }
  }, LOCAL_ORIGIN);

  const bus = new CommandBus(doc, 'bench-user');
  const scene = new SceneGraph(doc);
  const index = new SpatialIndex();
  index.rebuild(scene.getAllNodes());

  return { doc, bus, scene, index, nodeIds };
}

const fixture = populateThousandNodeDoc();
const targetPatches = fixture.nodeIds.slice(0, 100).map((id, idx) => ({
  id,
  patch: { x: (idx % 32) * 80 + 10, y: Math.floor(idx / 32) * 80 + 5 },
}));

describe('editor-core 1,000-node benchmarks', () => {
  bench(
    'create 1,000 nodes inside single Y.Doc transaction',
    () => {
      const doc = createInitialDoc({ clientId: 7 });
      const keys = generateSequentialKeys(null, null, 1000, doc.clientID);
      doc.transact(() => {
        const { nodes } = getDocRoots(doc);
        for (let i = 0; i < 1000; i += 1) {
          const id = `n-${i}`;
          const node = createDefaultNode({
            id,
            type: 'rect',
            pageId: DEFAULT_PAGE_ID,
            name: `Node ${i}`,
            x: (i % 32) * 80,
            y: Math.floor(i / 32) * 80,
            width: 64,
            height: 48,
            index: keys[i]!,
            createdBy: 'bench-user',
          });
          const nodeMap = new Y.Map<unknown>();
          nodes.set(id, nodeMap);
          writeNodeToMap(nodeMap, node);
        }
      }, LOCAL_ORIGIN);
    },
    { iterations: 10 },
  );

  bench('SpatialIndex.rebuild over 1,000 nodes', () => {
    const all = readAllNodesSorted(fixture.doc);
    fixture.index.rebuild(all);
  });

  bench('SpatialIndex.searchRect viewport query (1,000 nodes)', () => {
    fixture.index.searchRect({ x: 300, y: 200, width: 800, height: 600 });
  });

  bench('CommandBus.execute updateNodes (100 patches in 1,000-node doc)', () => {
    fixture.bus.execute({ type: 'updateNodes', patches: targetPatches });
  });
});
