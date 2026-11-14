import { Database } from '@hocuspocus/extension-database';
import { Server, type Hocuspocus } from '@hocuspocus/server';
import { initializeDocIfEmpty } from '@nova/editor-core';
import { MAX_REALTIME_MESSAGE_BYTES, RoleSchema, type Role } from '@nova/shared';
import { Redis } from 'ioredis';
import * as Y from 'yjs';
import { z } from 'zod';
import { getRealtimeConfig, type RealtimeConfig } from './config.js';
import { PostgresDocumentStore } from './database.js';
import { logger } from './logger.js';
import {
  decodeRestoreMessage,
  reconcileDocToSnapshot,
  RESTORE_CHANNEL_PREFIX,
} from './restore.js';
import {
  extractProjectIdFromDocName,
  verifyRealtimeTicket,
  type RealtimeConnectionContext,
} from './ticket.js';

export const ROLE_CHANGE_CHANNEL_PREFIX = 'nova:role-change:';

const RoleChangeMessageSchema = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  role: RoleSchema.nullable().optional(),
});

export type RoleChangePayload = z.infer<typeof RoleChangeMessageSchema>;

export interface RealtimeServerOptions extends Partial<RealtimeConfig> {
  unloadImmediately?: boolean;
  enableRedis?: boolean;
  stopOnSignals?: boolean;
}

export interface RealtimeServerHandle {
  readonly server: Server<RealtimeConnectionContext>;
  readonly hocuspocus: Hocuspocus<RealtimeConnectionContext>;
  readonly store: PostgresDocumentStore;
  listen: () => Promise<{ port: number; wsUrl: string; httpUrl: string }>;
  applyRestore: (projectId: string, snapshotBytes: Uint8Array) => Promise<void>;
  flushPendingStores: () => void;
  destroy: () => Promise<void>;
}

/**
 * Creates a configured NOVA STUDIO Hocuspocus realtime server backed by Postgres
 * (`ProjectDocument`) persistence, HS256 ticket auth, RBAC readOnly enforcement,
 * 1MB message limit guards, and Redis version-restore fanout.
 */
export function createRealtimeServer(
  options: RealtimeServerOptions = {},
): RealtimeServerHandle {
  const config = getRealtimeConfig(options);
  const store = new PostgresDocumentStore(config.databaseUrl);
  const enableRedis = options.enableRedis ?? true;
  let redisSub: Redis | null = null;
  let boundPort = config.port;
  let destroyed = false;

  const databaseExtension = new Database({
    fetch: async ({ documentName }) => {
      const projectId = extractProjectIdFromDocName(documentName);
      return store.fetchDocument(projectId);
    },
    store: async ({ documentName, state }) => {
      const projectId = extractProjectIdFromDocName(documentName);
      await store.storeDocument(projectId, state);
    },
  });

  const server = new Server<RealtimeConnectionContext>({
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: options.stopOnSignals ?? false,
    debounce: config.debounceMs,
    maxDebounce: config.maxDebounceMs,
    unloadImmediately: options.unloadImmediately ?? false,
    maxUnauthenticatedQueueSize: MAX_REALTIME_MESSAGE_BYTES,
    websocketOptions: {
      maxPayload: MAX_REALTIME_MESSAGE_BYTES,
    },
    extensions: [databaseExtension],
    onAuthenticate: async (data) => {
      const projectId = extractProjectIdFromDocName(data.documentName);
      const context = verifyRealtimeTicket(
        data.token,
        config.realtimeJwtSecret,
        projectId,
      );

      const exists = await store.projectExists(projectId);
      if (!exists) {
        throw new Error('Forbidden: project not found');
      }

      const activeDoc = data.instance.documents.get(data.documentName);
      if (activeDoc && activeDoc.getConnectionsCount() >= config.maxConnectionsPerDoc) {
        throw new Error('Too many concurrent connections for this document');
      }

      if (context.role === 'VIEWER') {
        data.connectionConfig.readOnly = true;
      }

      return context;
    },
    afterLoadDocument: async (data) => {
      initializeDocIfEmpty(data.document);
    },
    beforeHandleMessage: async (data) => {
      if (data.update.byteLength > MAX_REALTIME_MESSAGE_BYTES) {
        data.connection.close({ code: 1009, reason: 'Message too large' });
        throw new Error('Message too large');
      }
    },
    onRequest: async ({ request, response, instance }) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/health') {
        const body = JSON.stringify({
          status: 'ok',
          service: 'realtime',
          activeDocuments: instance.getDocumentsCount(),
          activeConnections: instance.getConnectionsCount(),
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(body);
        return Promise.reject();
      }
    },
  });

  const applyRestore = async (
    projectId: string,
    snapshotBytes: Uint8Array,
  ): Promise<void> => {
    const candidateNames = [`project:${projectId}`, projectId];
    let matchedDoc = false;

    for (const docName of candidateNames) {
      const liveDoc = server.hocuspocus.documents.get(docName);
      if (!liveDoc) {
        continue;
      }
      matchedDoc = true;
      reconcileDocToSnapshot(liveDoc, snapshotBytes);
      const encoded = Y.encodeStateAsUpdate(liveDoc);
      await store.storeDocument(projectId, encoded);
      liveDoc.broadcastStateless(
        JSON.stringify({
          type: 'version.restored',
          projectId,
        }),
      );
    }

    if (!matchedDoc) {
      await store.storeDocument(projectId, snapshotBytes);
    }
  };

  const applyRoleChange = async (payload: {
    userId: string;
    workspaceId?: string;
    projectId?: string;
    role?: Role | null;
  }): Promise<number> => {
    const activeEntries = Array.from(server.hocuspocus.documents.entries());
    if (activeEntries.length === 0) {
      return 0;
    }

    let allowedProjectIds: Set<string> | null = null;
    if (payload.projectId) {
      allowedProjectIds = new Set([payload.projectId]);
    } else if (payload.workspaceId) {
      const candidateProjectIds = activeEntries.map(([docName]) =>
        extractProjectIdFromDocName(docName),
      );
      allowedProjectIds = await store.filterProjectIdsInWorkspace(
        candidateProjectIds,
        payload.workspaceId,
      );
    }

    const statelessMessage = JSON.stringify({
      type: 'role.changed',
      userId: payload.userId,
      workspaceId: payload.workspaceId ?? null,
      projectId: payload.projectId ?? null,
      role: payload.role ?? null,
    });

    let closedCount = 0;
    for (const [docName, liveDoc] of activeEntries) {
      const docProjectId = extractProjectIdFromDocName(docName);
      if (allowedProjectIds && !allowedProjectIds.has(docProjectId)) {
        continue;
      }

      for (const conn of liveDoc.getConnections()) {
        const ctx = (conn as { context?: Partial<RealtimeConnectionContext> }).context;
        if (ctx?.userId === payload.userId) {
          try {
            conn.sendStateless(statelessMessage);
          } catch {
            // ignore send failures when closing socket
          }
          conn.close({ code: 4403, reason: 'Role updated' });
          try {
            conn.webSocket.close(4403, 'Role updated');
          } catch {
            // ignore socket close failures if already closing
          }
          closedCount += 1;
        }
      }
    }

    return closedCount;
  };

  const listen = async (): Promise<{ port: number; wsUrl: string; httpUrl: string }> => {
    if (enableRedis && !redisSub) {
      const sub = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      sub.on('error', (err) => {
        logger.error({ err }, 'Redis pub/sub subscriber error');
      });
      sub.on('pmessage', (_pattern, channel, message) => {
        if (channel.startsWith(RESTORE_CHANNEL_PREFIX)) {
          const projectId = channel.slice(RESTORE_CHANNEL_PREFIX.length);
          void (async () => {
            try {
              const bytes = decodeRestoreMessage(message);
              await applyRestore(projectId, bytes);
              logger.info({ projectId }, 'Applied version restore from Redis pub/sub');
            } catch (err) {
              logger.error({ err, projectId }, 'Failed to apply version restore');
            }
          })();
          return;
        }

        if (channel.startsWith(ROLE_CHANGE_CHANNEL_PREFIX)) {
          const channelWorkspaceId = channel.slice(ROLE_CHANGE_CHANNEL_PREFIX.length);
          void (async () => {
            try {
              const parsed = RoleChangeMessageSchema.parse(JSON.parse(message));
              const closedCount = await applyRoleChange({
                userId: parsed.userId,
                workspaceId: parsed.workspaceId ?? channelWorkspaceId,
                projectId: parsed.projectId,
                role: parsed.role,
              });
              logger.info(
                {
                  userId: parsed.userId,
                  workspaceId: parsed.workspaceId ?? channelWorkspaceId,
                  projectId: parsed.projectId,
                  closedCount,
                },
                'Processed role change notification from Redis pub/sub',
              );
            } catch (err) {
              logger.error({ err, channel }, 'Failed to process role change message');
            }
          })();
        }
      });
      await sub.connect();
      await sub.psubscribe(`${RESTORE_CHANNEL_PREFIX}*`, `${ROLE_CHANGE_CHANNEL_PREFIX}*`);
      redisSub = sub;
    }

    await server.listen();
    const addr = server.address;
    boundPort = typeof addr === 'object' && 'port' in addr ? addr.port : config.port;
    const clientHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
    const wsUrl = `ws://${clientHost}:${boundPort}`;
    const httpUrl = `http://${clientHost}:${boundPort}`;
    logger.info({ port: boundPort, host: config.host }, 'NOVA realtime server listening');
    return { port: boundPort, wsUrl, httpUrl };
  };

  const destroy = async (): Promise<void> => {
    if (destroyed) {
      return;
    }
    destroyed = true;

    try {
      server.hocuspocus.closeConnections();
      server.hocuspocus.flushPendingStores();
      await server.destroy();
    } finally {
      if (redisSub) {
        const sub = redisSub;
        redisSub = null;
        try {
          await sub.punsubscribe();
        } catch {
          // ignore unsubscribe error during shutdown
        }
        sub.disconnect();
      }
      await store.close();
    }
  };

  return {
    server,
    hocuspocus: server.hocuspocus,
    store,
    listen,
    applyRestore,
    flushPendingStores: () => server.hocuspocus.flushPendingStores(),
    destroy,
  };
}
