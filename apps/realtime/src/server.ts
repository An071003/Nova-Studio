import { Database } from '@hocuspocus/extension-database';
import { Server, type Hocuspocus } from '@hocuspocus/server';
import { initializeDocIfEmpty } from '@nova/editor-core';
import { MAX_REALTIME_MESSAGE_BYTES } from '@nova/shared';
import { Redis } from 'ioredis';
import * as Y from 'yjs';
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

  const listen = async (): Promise<{ port: number; wsUrl: string; httpUrl: string }> => {
    if (enableRedis && !redisSub) {
      const sub = new Redis(config.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      sub.on('error', (err) => {
        logger.error({ err }, 'Redis restore subscriber error');
      });
      sub.on('pmessage', (_pattern, channel, message) => {
        if (!channel.startsWith(RESTORE_CHANNEL_PREFIX)) {
          return;
        }
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
      });
      await sub.connect();
      await sub.psubscribe(`${RESTORE_CHANNEL_PREFIX}*`);
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
