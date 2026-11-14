import { randomUUID } from 'node:crypto';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import {
  CommandBus,
  createInitialDoc,
  readAllNodesSorted,
} from '@nova/editor-core';
import { MAX_REALTIME_MESSAGE_BYTES, type Role } from '@nova/shared';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { getRealtimeConfig } from '../src/config.js';
import { RESTORE_CHANNEL_PREFIX } from '../src/restore.js';
import { createRealtimeServer } from '../src/server.js';
import { signRealtimeTicket } from '../src/ticket.js';

const { Pool } = pg;

interface ConnectedClient {
  doc: Y.Doc;
  socket: HocuspocusProviderWebsocket;
  provider: HocuspocusProvider;
  statelessPayloads: string[];
  closeCodes: number[];
  authFailedReasons: string[];
  authenticatedScopes: string[];
  waitUntilSynced: () => Promise<void>;
  disconnect: () => void;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2500,
  label: string | (() => string) = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  const resolvedLabel = typeof label === 'function' ? label() : label;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${resolvedLabel}`);
}

function connectRealtimeClient(opts: {
  wsUrl: string;
  docName: string;
  token: string;
  doc?: Y.Doc;
}): ConnectedClient {
  const doc = opts.doc ?? new Y.Doc();
  const statelessPayloads: string[] = [];
  const closeCodes: number[] = [];
  const authFailedReasons: string[] = [];
  const authenticatedScopes: string[] = [];
  const statuses: string[] = [];
  const maxAttemptErrors: string[] = [];
  let opened = false;
  let msgCount = 0;
  let synced = false;

  const socket = new HocuspocusProviderWebsocket({
    url: opts.wsUrl,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    autoConnect: false,
    maxAttempts: 1,
    minDelay: 50,
    delay: 50,
    maxDelay: 200,
    initialDelay: 0,
    onOpen: () => {
      opened = true;
    },
    onMessage: () => {
      msgCount += 1;
    },
    onStatus: ({ status }) => {
      statuses.push(status);
    },
    onClose: ({ event }) => {
      closeCodes.push(event.code);
    },
    onMaxAttemptsFailed: ({ error }) => {
      maxAttemptErrors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    },
  });

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: opts.docName,
    token: opts.token,
    document: doc,
    onSynced: ({ state }) => {
      synced = state;
    },
    onAuthenticated: ({ scope }) => {
      authenticatedScopes.push(scope);
    },
    onAuthenticationFailed: ({ reason }) => {
      authFailedReasons.push(reason);
    },
    onStateless: ({ payload }) => {
      statelessPayloads.push(payload);
    },
  });

  provider.attach();
  void socket.connect();

  return {
    doc,
    socket,
    provider,
    statelessPayloads,
    closeCodes,
    authFailedReasons,
    authenticatedScopes,
    waitUntilSynced: () =>
      waitUntil(
        () => synced,
        2500,
        () =>
          `sync(${opts.docName}) [opened=${opened} msgs=${msgCount} statuses=${statuses.join(',')} scopes=${authenticatedScopes.join(',')} authErr=${authFailedReasons.join(',')} closes=${closeCodes.join(',')} maxErr=${maxAttemptErrors.join(',')}]`,
      ),
    disconnect: () => {
      provider.destroy();
      socket.destroy();
    },
  };
}

describe('realtime Hocuspocus server', () => {
  const config = getRealtimeConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const runId = randomUUID();
  const userOwnerId = `u-owner-${runId}`;
  const userEditorId = `u-editor-${runId}`;
  const userViewerId = `u-viewer-${runId}`;
  const workspaceId = `ws-${runId}`;
  const createdProjectIds: string[] = [];

  async function createProjectRow(suffix: string): Promise<string> {
    const projectId = `proj-${suffix}-${runId}`;
    await pool.query(
      `INSERT INTO "Project" ("id", "workspaceId", "name", "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      [projectId, workspaceId, `Project ${suffix}`, userOwnerId],
    );
    createdProjectIds.push(projectId);
    return projectId;
  }

  function makeTicket(userId: string, projectId: string, role: Role, expiresIn = 60): string {
    return signRealtimeTicket(
      {
        sub: userId,
        projectId,
        role,
        name: `User ${role}`,
        color: '#60A5FA',
      },
      config.realtimeJwtSecret,
      expiresIn,
    );
  }

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES
         ($1, $2, 'Owner User', 'hash', NOW()),
         ($3, $4, 'Editor User', 'hash', NOW()),
         ($5, $6, 'Viewer User', 'hash', NOW())`,
      [
        userOwnerId,
        `owner-${runId}@nova.test`,
        userEditorId,
        `editor-${runId}@nova.test`,
        userViewerId,
        `viewer-${runId}@nova.test`,
      ],
    );

    await pool.query(
      `INSERT INTO "Workspace" ("id", "name", "slug")
       VALUES ($1, $2, $3)`,
      [workspaceId, 'Realtime Test Workspace', `rt-ws-${runId}`],
    );

    await pool.query(
      `INSERT INTO "WorkspaceMember" ("workspaceId", "userId", "role")
       VALUES
         ($1, $2, 'OWNER'),
         ($1, $3, 'EDITOR'),
         ($1, $4, 'VIEWER')`,
      [workspaceId, userOwnerId, userEditorId, userViewerId],
    );
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await pool.query(`DELETE FROM "ProjectDocument" WHERE "projectId" = ANY($1::text[])`, [
        createdProjectIds,
      ]);
      await pool.query(`DELETE FROM "Project" WHERE "id" = ANY($1::text[])`, [
        createdProjectIds,
      ]);
    }
    await pool.query(`DELETE FROM "WorkspaceMember" WHERE "workspaceId" = $1`, [workspaceId]);
    await pool.query(`DELETE FROM "Workspace" WHERE "id" = $1`, [workspaceId]);
    await pool.query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [
      [userOwnerId, userEditorId, userViewerId],
    ]);
    await pool.end();
  });

  it('serves /health, syncs OWNER/EDITOR edits, enforces VIEWER readOnly, and rejects bad tickets', async () => {
    const projectId = await createProjectRow('sync');
    const docName = `project:${projectId}`;
    const rt = createRealtimeServer({
      port: 0,
      host: '127.0.0.1',
      enableRedis: false,
      debounceMs: 100,
      maxDebounceMs: 200,
    });
    const { wsUrl, httpUrl } = await rt.listen();
    const clients: ConnectedClient[] = [];

    try {
      const healthRes = await fetch(`${httpUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as {
        status: string;
        service: string;
      };
      expect(healthJson.status).toBe('ok');
      expect(healthJson.service).toBe('realtime');

      const ownerClient = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userOwnerId, projectId, 'OWNER'),
      });
      const editorClient = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userEditorId, projectId, 'EDITOR'),
      });
      const viewerClient = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userViewerId, projectId, 'VIEWER'),
      });
      clients.push(ownerClient, editorClient, viewerClient);

      await Promise.all([
        ownerClient.waitUntilSynced(),
        editorClient.waitUntilSynced(),
        viewerClient.waitUntilSynced(),
      ]);

      expect(ownerClient.authenticatedScopes).toEqual(['read-write']);
      expect(editorClient.authenticatedScopes).toEqual(['read-write']);
      expect(viewerClient.authenticatedScopes).toEqual(['readonly']);

      const ownerBus = new CommandBus(ownerClient.doc, userOwnerId);
      ownerBus.execute({
        type: 'createNode',
        input: {
          id: 'rect-sync-1',
          type: 'rect',
          name: 'Synced Rect',
          x: 42,
          y: 84,
          width: 140,
          height: 90,
        },
      });

      await waitUntil(
        () =>
          readAllNodesSorted(editorClient.doc).some((n) => n.id === 'rect-sync-1') &&
          readAllNodesSorted(viewerClient.doc).some((n) => n.id === 'rect-sync-1'),
        8000,
        'editor and viewer receiving created node',
      );

      const viewerBus = new CommandBus(viewerClient.doc, userViewerId);
      viewerBus.execute({
        type: 'createNode',
        input: {
          id: 'viewer-unauthorized-node',
          type: 'rect',
          name: 'Blocked Edit',
          x: 999,
          y: 999,
          width: 50,
          height: 50,
        },
      });

      const editorBus = new CommandBus(editorClient.doc, userEditorId);
      editorBus.execute({
        type: 'moveNodes',
        ids: ['rect-sync-1'],
        dx: 10,
        dy: 6,
      });

      await waitUntil(
        () =>
          readAllNodesSorted(ownerClient.doc).find((n) => n.id === 'rect-sync-1')?.x === 52 &&
          readAllNodesSorted(viewerClient.doc).find((n) => n.id === 'rect-sync-1')?.x === 52,
        8000,
        'move propagation round-trip',
      );

      expect(readAllNodesSorted(ownerClient.doc).some((n) => n.id === 'viewer-unauthorized-node')).toBe(false);
      expect(readAllNodesSorted(editorClient.doc).some((n) => n.id === 'viewer-unauthorized-node')).toBe(false);

      const badExpired = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userEditorId, projectId, 'EDITOR', -10),
      });
      const badProject = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userEditorId, 'wrong-project-id', 'EDITOR'),
      });
      const badSecret = connectRealtimeClient({
        wsUrl,
        docName,
        token: signRealtimeTicket(
          {
            sub: userEditorId,
            projectId,
            role: 'EDITOR',
            name: 'Hacker',
            color: '#F87171',
          },
          'wrong-secret-at-least-16-chars',
          60,
        ),
      });
      const missingProject = connectRealtimeClient({
        wsUrl,
        docName: `project:missing-${runId}`,
        token: makeTicket(userOwnerId, `missing-${runId}`, 'OWNER'),
      });
      clients.push(badExpired, badProject, badSecret, missingProject);

      await waitUntil(
        () =>
          badExpired.authFailedReasons.length > 0 &&
          badProject.authFailedReasons.length > 0 &&
          badSecret.authFailedReasons.length > 0 &&
          missingProject.authFailedReasons.length > 0,
        8000,
        'all invalid tickets failing authentication',
      );
    } finally {
      for (const client of clients) {
        client.disconnect();
      }
      await rt.destroy();
    }
  });

  it('rejects WebSocket updates larger than 1MB (MAX_REALTIME_MESSAGE_BYTES)', async () => {
    const projectId = await createProjectRow('oversize');
    const docName = `project:${projectId}`;
    const rt = createRealtimeServer({
      port: 0,
      host: '127.0.0.1',
      enableRedis: false,
      debounceMs: 100,
      maxDebounceMs: 200,
    });
    const { wsUrl } = await rt.listen();
    const clients: ConnectedClient[] = [];

    try {
      const observer = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userOwnerId, projectId, 'OWNER'),
      });
      const sender = connectRealtimeClient({
        wsUrl,
        docName,
        token: makeTicket(userEditorId, projectId, 'EDITOR'),
      });
      clients.push(observer, sender);

      await Promise.all([observer.waitUntilSynced(), sender.waitUntilSynced()]);

      const hugeString = 'A'.repeat(MAX_REALTIME_MESSAGE_BYTES + 16_384);
      sender.doc.transact(() => {
        sender.doc.getMap('meta').set('oversizeBlob', hugeString);
      }, 'local');

      await waitUntil(
        () => sender.closeCodes.some((code) => code === 1009 || code === 1006),
        8000,
        'sender closed on >1MB frame',
      );

      const observerBus = new CommandBus(observer.doc, userOwnerId);
      observerBus.execute({
        type: 'createNode',
        input: { id: 'after-oversize', type: 'rect', x: 10, y: 10, width: 30, height: 30 },
      });

      await waitUntil(
        () => rt.hocuspocus.documents.get(docName) !== undefined,
        4000,
        'doc loaded on server',
      );
      const serverDoc = rt.hocuspocus.documents.get(docName);
      expect(serverDoc?.getMap('meta').has('oversizeBlob')).toBe(false);
    } finally {
      for (const client of clients) {
        client.disconnect();
      }
      await rt.destroy();
    }
  });

  it('persists document state in Postgres across server restarts and applies Redis restore events', async () => {
    const projectId = await createProjectRow('persist');
    const docName = `project:${projectId}`;

    const rt1 = createRealtimeServer({
      port: 0,
      host: '127.0.0.1',
      debounceMs: 50,
      maxDebounceMs: 100,
      unloadImmediately: true,
    });
    const { wsUrl: wsUrl1 } = await rt1.listen();
    let v1SnapshotBytes: Uint8Array;

    const c1 = connectRealtimeClient({
      wsUrl: wsUrl1,
      docName,
      token: makeTicket(userOwnerId, projectId, 'OWNER'),
    });

    try {
      await c1.waitUntilSynced();
      const bus1 = new CommandBus(c1.doc, userOwnerId);
      bus1.execute({
        type: 'createNode',
        input: {
          id: 'persisted-v1',
          type: 'rect',
          name: 'Version 1 Node',
          x: 100,
          y: 200,
          width: 150,
          height: 80,
        },
      });

      const localSnapshotDoc = createInitialDoc();
      localSnapshotDoc.getMap('meta').set('createdAt', c1.doc.getMap('meta').get('createdAt'));
      new CommandBus(localSnapshotDoc, userOwnerId).execute({
        type: 'createNode',
        input: {
          id: 'persisted-v1',
          type: 'rect',
          name: 'Version 1 Node',
          x: 100,
          y: 200,
          width: 150,
          height: 80,
        },
      });
      v1SnapshotBytes = Y.encodeStateAsUpdate(localSnapshotDoc);
      localSnapshotDoc.destroy();

      await waitUntil(async () => {
        const stored = await rt1.store.fetchDocument(projectId);
        return stored !== null;
      }, 8000, 'Postgres document store write');
    } finally {
      c1.disconnect();
      await rt1.destroy();
    }

    const rt2 = createRealtimeServer({
      port: 0,
      host: '127.0.0.1',
      debounceMs: 50,
      maxDebounceMs: 100,
    });
    const { wsUrl: wsUrl2 } = await rt2.listen();
    const redisPub = new Redis(config.redisUrl);
    const clients2: ConnectedClient[] = [];

    try {
      const c2Owner = connectRealtimeClient({
        wsUrl: wsUrl2,
        docName,
        token: makeTicket(userOwnerId, projectId, 'OWNER'),
      });
      const c2Editor = connectRealtimeClient({
        wsUrl: wsUrl2,
        docName,
        token: makeTicket(userEditorId, projectId, 'EDITOR'),
      });
      clients2.push(c2Owner, c2Editor);

      await Promise.all([c2Owner.waitUntilSynced(), c2Editor.waitUntilSynced()]);

      const restoredFromDb = readAllNodesSorted(c2Owner.doc).find((n) => n.id === 'persisted-v1');
      expect(restoredFromDb?.name).toBe('Version 1 Node');
      expect(restoredFromDb?.x).toBe(100);

      const bus2 = new CommandBus(c2Owner.doc, userOwnerId);
      bus2.execute({
        type: 'moveNodes',
        ids: ['persisted-v1'],
        dx: 300,
        dy: 50,
      });
      bus2.execute({
        type: 'createNode',
        input: {
          id: 'v2-extra-node',
          type: 'ellipse',
          name: 'V2 Extra',
          x: 50,
          y: 50,
          width: 90,
          height: 90,
        },
      });

      await waitUntil(
        () =>
          readAllNodesSorted(c2Editor.doc).some((n) => n.id === 'v2-extra-node') &&
          readAllNodesSorted(c2Editor.doc).find((n) => n.id === 'persisted-v1')?.x === 400,
        8000,
        'v2 edits replicated to editor before restore',
      );

      await redisPub.publish(
        `${RESTORE_CHANNEL_PREFIX}${projectId}`,
        Buffer.from(v1SnapshotBytes).toString('base64'),
      );

      await waitUntil(
        () =>
          c2Owner.statelessPayloads.some((p) => p.includes('version.restored')) &&
          c2Editor.statelessPayloads.some((p) => p.includes('version.restored')) &&
          !readAllNodesSorted(c2Owner.doc).some((n) => n.id === 'v2-extra-node') &&
          !readAllNodesSorted(c2Editor.doc).some((n) => n.id === 'v2-extra-node') &&
          readAllNodesSorted(c2Owner.doc).find((n) => n.id === 'persisted-v1')?.x === 100 &&
          readAllNodesSorted(c2Editor.doc).find((n) => n.id === 'persisted-v1')?.x === 100,
        8000,
        'Redis pub/sub rollback on all connected peers',
      );
    } finally {
      for (const client of clients2) {
        client.disconnect();
      }
      redisPub.disconnect();
      await rt2.destroy();
    }
  });
});
