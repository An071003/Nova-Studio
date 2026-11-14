import * as Y from 'yjs';
import { CommandBus } from '../src/commands/commands.js';
import { initializeDocIfEmpty, serializeDocSnapshot } from '../src/model/doc.js';
import { SceneGraph } from '../src/scene/scene-graph.js';

const SYNC_ORIGIN = 'test:sync';

export interface TestPeer {
  index: number;
  userId: string;
  doc: Y.Doc;
  bus: CommandBus;
  scene: SceneGraph;
  paused: boolean;
}

export interface QueuedPacket {
  from: number;
  to: number;
  update: Uint8Array;
}

export interface PeerNetwork {
  peers: TestPeer[];
  queue: QueuedPacket[];
  pause(peerIndex: number): void;
  resume(peerIndex: number): void;
  flushAll(): void;
  deliverRandomOrder(seed?: number): number;
  destroy(): void;
}

/** Deterministic PRNG (Mulberry32) for reproducible convergence & shuffle tests. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spawns `count` headless Y.Doc peers linked through a controllable packet queue
 * supporting offline `pause()/resume()` and out-of-order delivery.
 */
export function createPeers(count: number, opts?: { title?: string }): PeerNetwork {
  const seedDoc = new Y.Doc();
  seedDoc.clientID = 1;
  initializeDocIfEmpty(seedDoc, opts);
  const initialState = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();

  const peers: TestPeer[] = [];
  const queue: QueuedPacket[] = [];

  for (let i = 0; i < count; i += 1) {
    const doc = new Y.Doc();
    doc.clientID = 100 + i * 37;
    Y.applyUpdate(doc, initialState, SYNC_ORIGIN);

    const userId = `user-${i + 1}`;
    const bus = new CommandBus(doc, userId);
    const scene = new SceneGraph(doc);

    const peer: TestPeer = {
      index: i,
      userId,
      doc,
      bus,
      scene,
      paused: false,
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === SYNC_ORIGIN) {
        return;
      }
      for (let target = 0; target < peers.length; target += 1) {
        if (target !== i) {
          queue.push({ from: i, to: target, update });
        }
      }
    });

    peers.push(peer);
  }

  function deliverPacket(pkt: QueuedPacket): boolean {
    const sender = peers[pkt.from];
    const receiver = peers[pkt.to];
    if (!sender || !receiver || sender.paused || receiver.paused) {
      return false;
    }
    Y.applyUpdate(receiver.doc, pkt.update, SYNC_ORIGIN);
    return true;
  }

  return {
    peers,
    queue,
    pause(peerIndex: number) {
      const peer = peers[peerIndex];
      if (peer) {
        peer.paused = true;
      }
    },
    resume(peerIndex: number) {
      const peer = peers[peerIndex];
      if (!peer) {
        return;
      }
      peer.paused = false;
      // Deliver any packets queued to/from online peers now that peer is back online
      const remaining: QueuedPacket[] = [];
      for (const pkt of queue) {
        if (!deliverPacket(pkt)) {
          remaining.push(pkt);
        }
      }
      queue.length = 0;
      queue.push(...remaining);

      // Perform state-vector catchup against all other unpaused peers (matches Hocuspocus sync step)
      for (const other of peers) {
        if (other.index !== peerIndex && !other.paused) {
          const diffToPeer = Y.encodeStateAsUpdate(other.doc, Y.encodeStateVector(peer.doc));
          const diffToOther = Y.encodeStateAsUpdate(peer.doc, Y.encodeStateVector(other.doc));
          Y.applyUpdate(peer.doc, diffToPeer, SYNC_ORIGIN);
          Y.applyUpdate(other.doc, diffToOther, SYNC_ORIGIN);
        }
      }
    },
    flushAll() {
      let progress = true;
      while (progress && queue.length > 0) {
        progress = false;
        const remaining: QueuedPacket[] = [];
        for (const pkt of queue) {
          if (deliverPacket(pkt)) {
            progress = true;
          } else {
            remaining.push(pkt);
          }
        }
        queue.length = 0;
        queue.push(...remaining);
      }
    },
    deliverRandomOrder(seed = 42): number {
      const rng = createPrng(seed);
      let delivered = 0;
      while (queue.length > 0) {
        const deliverableIndices: number[] = [];
        for (let i = 0; i < queue.length; i += 1) {
          const pkt = queue[i]!;
          if (!peers[pkt.from]?.paused && !peers[pkt.to]?.paused) {
            deliverableIndices.push(i);
          }
        }
        if (deliverableIndices.length === 0) {
          break;
        }
        const pick = Math.floor(rng() * deliverableIndices.length);
        const queueIndex = deliverableIndices[pick]!;
        const [pkt] = queue.splice(queueIndex, 1);
        if (pkt && deliverPacket(pkt)) {
          delivered += 1;
        }
      }
      return delivered;
    },
    destroy() {
      for (const peer of peers) {
        peer.scene.destroy();
        peer.doc.destroy();
      }
    },
  };
}

export function makePeerPair() {
  const network = createPeers(2);
  return {
    a: network.peers[0]!,
    b: network.peers[1]!,
    network,
    snapshotA: () => serializeDocSnapshot(network.peers[0]!.doc),
    snapshotB: () => serializeDocSnapshot(network.peers[1]!.doc),
  };
}
