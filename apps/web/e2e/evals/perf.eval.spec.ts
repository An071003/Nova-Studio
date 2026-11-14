import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  CommandBus,
  createDefaultNode,
  generateSequentialKeys,
  getDocRoots,
  initializeDocIfEmpty,
  LOCAL_ORIGIN,
  readAllNodesSorted,
  writeNodeToMap,
} from '@nova/editor-core';
import { DEFAULT_PAGE_ID, type CanvasNode } from '@nova/shared';
import type { APIRequestContext } from '@playwright/test';
import * as Y from 'yjs';
import { createMultiplayerProject, expect, test } from '../fixtures/multiplayer';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

const NODE_COUNT = 1000;
const CLIENT_COUNT = 10;
const OPS_PER_SECOND = 5;
const DURATION_SECONDS = 60;
const OPS_PER_CLIENT = OPS_PER_SECOND * DURATION_SECONDS;
const PALETTE = ['#7C5CFF', '#22D3EE', '#38BDF8', '#F472B6', '#FBBF24'] as const;

interface TicketResponse {
  ticket: string;
  wsUrl: string;
  role: string;
}

interface HeadlessClient {
  index: number;
  doc: Y.Doc;
  bus: CommandBus;
  socket: HocuspocusProviderWebsocket;
  provider: HocuspocusProvider;
  waitUntilSynced: () => Promise<void>;
  disconnect: () => void;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchRealtimeTicket(
  request: APIRequestContext,
  projectId: string,
  accessToken: string,
): Promise<TicketResponse> {
  const res = await request.post(`/api/v1/projects/${projectId}/realtime-ticket`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok()) {
    throw new Error(`Failed to fetch realtime ticket (${res.status()})`);
  }
  return (await res.json()) as TicketResponse;
}

function connectHeadlessClient(opts: {
  index: number;
  projectId: string;
  request: APIRequestContext;
  accessToken: string;
  initialTicket: TicketResponse;
  errors: string[];
}): HeadlessClient {
  const doc = new Y.Doc();
  const bus = new CommandBus(doc, `e12-client-${opts.index}`);
  let synced = false;
  let pendingToken: string | null = opts.initialTicket.ticket;

  const socket = new HocuspocusProviderWebsocket({
    url: opts.initialTicket.wsUrl,
    WebSocketPolyfill: globalThis.WebSocket,
    autoConnect: false,
    minDelay: 50,
    delay: 100,
    maxDelay: 1000,
    initialDelay: 0,
    onMaxAttemptsFailed: ({ error }) => {
      opts.errors.push(
        `Client ${opts.index} max attempts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `project:${opts.projectId}`,
    document: doc,
    token: async () => {
      if (pendingToken) {
        const t = pendingToken;
        pendingToken = null;
        return t;
      }
      const next = await fetchRealtimeTicket(opts.request, opts.projectId, opts.accessToken);
      return next.ticket;
    },
    onSynced: ({ state }) => {
      if (state) {
        synced = true;
      }
    },
    onAuthenticationFailed: ({ reason }) => {
      opts.errors.push(`Client ${opts.index} auth failed: ${reason}`);
    },
  });

  provider.attach();
  void socket.connect();

  return {
    index: opts.index,
    doc,
    bus,
    socket,
    provider,
    waitUntilSynced: async () => {
      const deadline = Date.now() + 10_000;
      while (!synced) {
        if (Date.now() > deadline) {
          throw new Error(`Client ${opts.index} timed out waiting for Hocuspocus sync`);
        }
        await delayMs(20);
      }
    },
    disconnect: () => {
      provider.destroy();
      socket.destroy();
      doc.destroy();
    },
  };
}

function seedThousandNodes(doc: Y.Doc): string[] {
  initializeDocIfEmpty(doc);
  const keys = generateSequentialKeys(null, null, NODE_COUNT, doc.clientID);
  const nodeIds: string[] = [];

  doc.transact(() => {
    const { nodes } = getDocRoots(doc);
    for (let i = 0; i < NODE_COUNT; i += 1) {
      const id = `e12-node-${i}`;
      nodeIds.push(id);
      const col = i % 40;
      const row = Math.floor(i / 40);
      const node = createDefaultNode({
        id,
        type: i % 5 === 0 ? 'ellipse' : 'rect',
        pageId: DEFAULT_PAGE_ID,
        name: `Node-${i}`,
        x: 40 + col * 28,
        y: 40 + row * 24,
        width: 20,
        height: 16,
        fill: PALETTE[i % PALETTE.length]!,
        index: keys[i]!,
        createdBy: 'e12-seeder',
      });
      const nodeMap = new Y.Map<unknown>();
      nodes.set(id, nodeMap);
      writeNodeToMap(nodeMap, node);
    }
  }, LOCAL_ORIGIN);

  return nodeIds;
}

function summarizeScene(nodes: CanvasNode[]): string[] {
  return nodes.map((n) => `${n.id}:${n.name}:${Math.round(n.x)}:${Math.round(n.y)}`);
}

test.describe('P1-T23 Performance & Concurrency Eval (E12)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E12: 1,000 nodes load <= 2s and 10 headless clients @ 5 ops/s for 60s converge with p95 <= 150ms and 0 errors', async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const harness = await createMultiplayerProject(browser, 'Eval-E12', ['OWNER']);
    const owner = harness.sessions[0];
    if (!owner) {
      throw new Error('Expected owner session');
    }

    const errors: string[] = [];
    const headlessClients: HeadlessClient[] = [];
    let seedClient: HeadlessClient | null = null;

    try {
      const refreshRes = await owner.context.request.post('/api/v1/auth/refresh');
      expect(refreshRes.ok()).toBe(true);
      const { accessToken } = (await refreshRes.json()) as { accessToken: string };

      // 1. Seed 1,000 nodes via headless client before measuring cold/fresh page load time
      const seedTicket = await fetchRealtimeTicket(owner.context.request, harness.projectId, accessToken);
      seedClient = connectHeadlessClient({
        index: -1,
        projectId: harness.projectId,
        request: owner.context.request,
        accessToken,
        initialTicket: seedTicket,
        errors,
      });
      await seedClient.waitUntilSynced();

      const nodeIds = seedThousandNodes(seedClient.doc);
      expect(nodeIds).toHaveLength(NODE_COUNT);

      await expect
        .poll(() => owner.page.getByText(`${NODE_COUNT} layers`).isVisible())
        .toBe(true);

      // Keep seedClient connected briefly while closing initial owner tab so the 1,000-node room stays warm/persisted,
      // then measure fresh route load into /project/[id]
      await owner.page.close();

      const measurePage = await owner.context.newPage();
      measurePage.on('pageerror', (err) => {
        errors.push(`Browser pageerror: ${err.message}`);
      });
      measurePage.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(`Browser console.error: ${msg.text()}`);
        }
      });

      const loadStart = performance.now();
      await measurePage.goto(`/project/${harness.projectId}`);
      await expect(measurePage.locator('[data-testid="connection-status"]')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 10_000 },
      );
      await expect(measurePage.getByText(`${NODE_COUNT} layers`)).toBeVisible({ timeout: 10_000 });
      await expect(measurePage.locator('[data-testid="canvas-stage"] canvas').first()).toBeVisible({
        timeout: 10_000,
      });
      const loadMs = performance.now() - loadStart;
      // eslint-disable-next-line no-console
      console.log(`[E12] 1,000-node project load time: ${loadMs.toFixed(1)}ms`);
      expect(loadMs).toBeLessThanOrEqual(2000);

      // 2. Connect 10 concurrent headless Hocuspocus clients and verify each holds all 1,000 nodes
      for (let i = 0; i < CLIENT_COUNT; i += 1) {
        const ticket = await fetchRealtimeTicket(owner.context.request, harness.projectId, accessToken);
        const client = connectHeadlessClient({
          index: i,
          projectId: harness.projectId,
          request: owner.context.request,
          accessToken,
          initialTicket: ticket,
          errors,
        });
        headlessClients.push(client);
      }

      await Promise.all(headlessClients.map((c) => c.waitUntilSynced()));
      for (const client of headlessClients) {
        await expect.poll(() => readAllNodesSorted(client.doc).length).toBe(NODE_COUNT);
      }

      // Disconnect seedClient cleanly once the 10 benchmark clients + browser are connected
      seedClient.disconnect();
      seedClient = null;

      // 3. Measure end-to-end replication latency: when client c writes opTag `E12-c-k`, record arrival at observer `(c + 1) % 10`
      const sentAtByTag = new Map<string, number>();
      const latenciesMs: number[] = [];

      for (let observerIdx = 0; observerIdx < CLIENT_COUNT; observerIdx += 1) {
        const client = headlessClients[observerIdx]!;
        const watchedPrefix = `E12-${(observerIdx + CLIENT_COUNT - 1) % CLIENT_COUNT}-`;
        const { nodes } = getDocRoots(client.doc);
        nodes.observeDeep((events, tr) => {
          if (tr.local) return;
          const now = performance.now();
          for (const event of events) {
            if (!(event instanceof Y.YMapEvent)) continue;
            if (!event.keysChanged.has('name')) continue;
            const tag = event.target.get('name');
            if (typeof tag === 'string' && tag.startsWith(watchedPrefix)) {
              const sentAt = sentAtByTag.get(tag);
              if (sentAt !== undefined) {
                latenciesMs.push(now - sentAt);
                sentAtByTag.delete(tag);
              }
            }
          }
        });
      }

      // 4. Run 10 concurrent clients x 5 ops/s x 60s = 3,000 total replicated ops (staggered 20ms per client)
      const intervalMs = 1000 / OPS_PER_SECOND;
      const runStart = performance.now();

      await Promise.all(
        headlessClients.map(async (client, clientIdx) => {
          const staggerMs = clientIdx * (intervalMs / CLIENT_COUNT);
          await delayMs(staggerMs);
          for (let opIdx = 0; opIdx < OPS_PER_CLIENT; opIdx += 1) {
            const nodeIdx = clientIdx * 10 + (opIdx % 10);
            const targetId = nodeIds[nodeIdx]!;
            const baseCol = nodeIdx % 40;
            const opTag = `E12-${clientIdx}-${opIdx}`;
            sentAtByTag.set(opTag, performance.now());

            client.bus.execute({
              type: 'updateNodes',
              patches: [
                {
                  id: targetId,
                  patch: {
                    name: opTag,
                    x: 40 + baseCol * 28 + ((opIdx % 6) + 1) * 2,
                  },
                },
              ],
            });

            const nextTickAt = runStart + staggerMs + (opIdx + 1) * intervalMs;
            const wait = nextTickAt - performance.now();
            if (wait > 0 && opIdx < OPS_PER_CLIENT - 1) {
              await delayMs(wait);
            }
          }
        }),
      );

      // 5. Wait for 100% convergence across all 10 clients and live Playwright browser view
      await expect
        .poll(() => sentAtByTag.size, { timeout: 10_000 })
        .toBe(0);

      const expectedFirstSummary = summarizeScene(readAllNodesSorted(headlessClients[0]!.doc));
      expect(expectedFirstSummary).toHaveLength(NODE_COUNT);

      for (let i = 1; i < headlessClients.length; i += 1) {
        await expect
          .poll(() => summarizeScene(readAllNodesSorted(headlessClients[i]!.doc)), {
            timeout: 10_000,
          })
          .toEqual(expectedFirstSummary);
      }

      await expect
        .poll(
          async () => {
            const browserNodes = await measurePage.evaluate(() => window.__nova?.scene() ?? []);
            return summarizeScene(browserNodes);
          },
          { timeout: 10_000 },
        )
        .toEqual(expectedFirstSummary);

      const sorted = [...latenciesMs].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 9999;
      const max = sorted[sorted.length - 1] ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[E12] 10 clients x 5 ops/s x 60s (${latenciesMs.length} ops measured): p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`,
      );

      expect(errors).toEqual([]);
      expect(latenciesMs.length).toBeGreaterThanOrEqual(OPS_PER_CLIENT * CLIENT_COUNT * 0.95);
      expect(p95).toBeLessThanOrEqual(150);

      await measurePage.screenshot({ path: path.join(SCREENSHOT_DIR, 'E12.png') });
    } finally {
      if (seedClient) {
        seedClient.disconnect();
      }
      for (const client of headlessClients) {
        client.disconnect();
      }
      await harness.closeAll();
    }
  });
});
