import {
  colorForUserId,
  PresenceSchema,
  type Point,
  type Presence,
  type ToolId,
  type ViewportState,
} from '@nova/shared';

export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  on(name: 'change', cb: () => void): void;
  off(name: 'change', cb: () => void): void;
}

export interface RemotePresence {
  clientId: number;
  presence: Presence;
}

export type PresenceListener = (remotes: RemotePresence[]) => void;

export interface PresenceManagerOptions {
  userId: string;
  userName?: string;
  userColor?: string;
  avatarUrl?: string;
  awareness?: AwarenessLike;
  cursorThrottleMs?: number;
  cursorIdleMs?: number;
  now?: () => number;
}

/**
 * Synchronizes local ephemeral cursor/selection/tool/drag/viewport state with Yjs Awareness
 * at ~30Hz throttle and auto-hides idle cursors after 10 seconds.
 */
export class PresenceManager {
  private readonly awareness?: AwarenessLike;
  private readonly cursorThrottleMs: number;
  private readonly cursorIdleMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<PresenceListener>();
  private readonly onAwarenessChange: () => void;

  private localState: Presence;
  private lastCursorEmitAt = 0;
  private pendingCursor: Point | null | undefined = undefined;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PresenceManagerOptions) {
    this.awareness = opts.awareness;
    this.cursorThrottleMs = opts.cursorThrottleMs ?? 33;
    this.cursorIdleMs = opts.cursorIdleMs ?? 10_000;
    this.now = opts.now ?? (() => Date.now());

    this.localState = {
      user: {
        id: opts.userId,
        name: opts.userName ?? opts.userId,
        color: opts.userColor ?? colorForUserId(opts.userId),
        ...(opts.avatarUrl ? { avatarUrl: opts.avatarUrl } : {}),
      },
      cursor: null,
      selection: [],
      tool: 'select',
    };

    this.onAwarenessChange = () => {
      this.emit();
    };

    if (this.awareness) {
      this.awareness.setLocalState(this.localState as unknown as Record<string, unknown>);
      this.awareness.on('change', this.onAwarenessChange);
    }
  }

  getLocalPresence(): Presence {
    return this.localState;
  }

  setCursor(cursor: Point | null): void {
    this.resetIdleTimer(cursor !== null);

    if (cursor === null) {
      this.clearThrottleTimer();
      this.pendingCursor = undefined;
      this.commitField('cursor', null);
      return;
    }

    const elapsed = this.now() - this.lastCursorEmitAt;
    if (elapsed >= this.cursorThrottleMs) {
      this.clearThrottleTimer();
      this.pendingCursor = undefined;
      this.lastCursorEmitAt = this.now();
      this.commitField('cursor', cursor);
    } else {
      this.pendingCursor = cursor;
      if (!this.throttleTimer) {
        const delay = Math.max(0, this.cursorThrottleMs - elapsed);
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          if (this.pendingCursor !== undefined) {
            const pt = this.pendingCursor;
            this.pendingCursor = undefined;
            this.lastCursorEmitAt = this.now();
            this.commitField('cursor', pt);
          }
        }, delay);
      }
    }
  }

  setSelection(selection: string[]): void {
    this.commitField('selection', selection);
  }

  setTool(tool: ToolId): void {
    this.commitField('tool', tool);
  }

  setDragging(dragging: Presence['dragging'] | undefined): void {
    if (dragging === undefined) {
      const next = { ...this.localState };
      delete next.dragging;
      this.localState = next;
      this.awareness?.setLocalStateField('dragging', undefined);
      return;
    }
    this.commitField('dragging', dragging);
  }

  setViewport(viewport: ViewportState): void {
    this.commitField('viewport', viewport);
  }

  /** Returns all valid remote peer presence records excluding this client. */
  getRemotePresences(): RemotePresence[] {
    if (!this.awareness) {
      return [];
    }
    const result: RemotePresence[] = [];
    this.awareness.getStates().forEach((rawState, clientId) => {
      if (clientId === this.awareness?.clientID || !rawState) {
        return;
      }
      const parsed = PresenceSchema.safeParse(rawState);
      if (parsed.success) {
        result.push({ clientId, presence: parsed.data });
      }
    });
    return result;
  }

  subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.clearThrottleTimer();
    this.clearIdleTimer();
    if (this.awareness) {
      this.awareness.off('change', this.onAwarenessChange);
      this.awareness.setLocalState(null);
    }
    this.listeners.clear();
  }

  private commitField<K extends keyof Presence>(key: K, value: Presence[K]): void {
    this.localState = { ...this.localState, [key]: value };
    this.awareness?.setLocalStateField(key, value);
  }

  private clearThrottleTimer(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(active: boolean): void {
    this.clearIdleTimer();
    if (!active) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.commitField('cursor', null);
    }, this.cursorIdleMs);
  }

  private emit(): void {
    const remotes = this.getRemotePresences();
    for (const cb of this.listeners) {
      cb(remotes);
    }
  }
}
