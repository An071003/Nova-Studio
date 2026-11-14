import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';
import type { AwarenessLike } from '@nova/editor-core';
import { apiClient } from './api';

export type RealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';

export interface RealtimeSession {
  readonly awareness: AwarenessLike;
  readonly provider: HocuspocusProvider;
  readonly socket: HocuspocusProviderWebsocket;
  readonly idb: IndexeddbPersistence | null;
  connect: () => void;
  destroy: () => Promise<void>;
}

export interface CreateRealtimeSessionOptions {
  projectId: string;
  doc: Y.Doc;
  onStatusChange: (state: RealtimeConnectionState) => void;
  onScopeChange?: (scope: 'read-write' | 'readonly') => void;
  onStatelessMessage?: (payload: string) => void;
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export async function createRealtimeSession(
  opts: CreateRealtimeSessionOptions,
): Promise<RealtimeSession> {
  const { projectId, doc, onStatusChange, onScopeChange, onStatelessMessage } = opts;

  let currentState: RealtimeConnectionState = isBrowserOffline() ? 'offline' : 'connecting';
  let hasSyncedOnce = false;
  let manualOffline = isBrowserOffline();
  let destroyed = false;

  const emitState = (next: RealtimeConnectionState) => {
    if (destroyed || currentState === next) return;
    currentState = next;
    onStatusChange(next);
  };

  onStatusChange(currentState);

  const idb =
    typeof indexedDB !== 'undefined'
      ? new IndexeddbPersistence(`nova:project:${projectId}`, doc)
      : null;

  const initialTicket = await apiClient.issueRealtimeTicket(projectId);
  let pendingToken: string | null = initialTicket.ticket;

  const socket = new HocuspocusProviderWebsocket({
    url: initialTicket.wsUrl,
    autoConnect: false,
    minDelay: 100,
    delay: 250,
    maxDelay: 3000,
    initialDelay: 0,
    onStatus: ({ status }) => {
      if (destroyed) return;
      if (manualOffline || isBrowserOffline()) {
        emitState('offline');
        return;
      }
      if (status === WebSocketStatus.Connecting) {
        emitState(hasSyncedOnce ? 'reconnecting' : 'connecting');
      } else if (status === WebSocketStatus.Disconnected) {
        emitState(hasSyncedOnce ? 'reconnecting' : 'connecting');
      }
    },
    onClose: () => {
      if (destroyed) return;
      if (manualOffline || isBrowserOffline()) {
        emitState('offline');
      } else if (hasSyncedOnce) {
        emitState('reconnecting');
      }
    },
  });

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `project:${projectId}`,
    document: doc,
    token: async () => {
      if (pendingToken) {
        const token = pendingToken;
        pendingToken = null;
        return token;
      }
      const refreshed = await apiClient.issueRealtimeTicket(projectId);
      return refreshed.ticket;
    },
    onAuthenticated: ({ scope }) => {
      if (!destroyed) {
        onScopeChange?.(scope);
      }
    },
    onAuthenticationFailed: () => {
      pendingToken = null;
      if (!destroyed) {
        emitState(manualOffline || isBrowserOffline() ? 'offline' : 'reconnecting');
      }
    },
    onSynced: ({ state }) => {
      if (destroyed) return;
      if (state && !manualOffline && !isBrowserOffline()) {
        hasSyncedOnce = true;
        emitState('connected');
      }
    },
    onStateless: ({ payload }) => {
      if (!destroyed) {
        onStatelessMessage?.(payload);
      }
    },
  });

  // HocuspocusProvider with explicit websocketProvider requires manual attach() (L-009)
  provider.attach();

  const handleBrowserOffline = () => {
    manualOffline = true;
    emitState('offline');
    socket.disconnect();
  };

  const handleBrowserOnline = () => {
    manualOffline = false;
    emitState(hasSyncedOnce ? 'reconnecting' : 'connecting');
    void socket.connect();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', handleBrowserOffline);
    window.addEventListener('online', handleBrowserOnline);
  }

  return {
    awareness: provider.awareness as unknown as AwarenessLike,
    provider,
    socket,
    idb,
    connect: () => {
      if (!destroyed && !manualOffline && !isBrowserOffline()) {
        void socket.connect();
      }
    },
    destroy: async () => {
      if (destroyed) return;
      destroyed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleBrowserOffline);
        window.removeEventListener('online', handleBrowserOnline);
      }
      provider.destroy();
      socket.destroy();
      await idb?.destroy().catch(() => {});
    },
  };
}
