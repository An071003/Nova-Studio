'use client';

import type { ToolId } from '@nova/shared';

export interface StatusBarProps {
  connectionState: 'local' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
  activeTool: ToolId;
  readOnly: boolean;
  zoom: number;
  nodeCount: number;
  selectedCount: number;
}

const TOOL_HINTS: Record<ToolId, string> = {
  select: 'Click to select · Drag to move · Shift+Click for multi-select · Del to remove',
  frame: 'Drag to draw Frame · Hold Shift for square',
  rect: 'Drag to draw Rectangle · Hold Shift for square',
  ellipse: 'Drag to draw Ellipse · Hold Shift for circle',
  line: 'Drag to draw Line',
  text: 'Click or drag to place Text · Double-click text to edit',
  image: 'Drop an image or click on canvas to place Image',
  hand: 'Drag canvas to pan · Ctrl/Cmd+Wheel to zoom',
};

const CONNECTION_LABELS: Record<StatusBarProps['connectionState'], { label: string; dotClass: string }> = {
  local: { label: 'Local canvas ready', dotClass: 'bg-[var(--success)]' },
  connecting: { label: 'Connecting…', dotClass: 'bg-[var(--warning)]' },
  connected: { label: 'Synced', dotClass: 'bg-[var(--success)]' },
  reconnecting: { label: 'Reconnecting…', dotClass: 'bg-[var(--warning)]' },
  offline: { label: 'Offline (queued locally)', dotClass: 'bg-[var(--danger)]' },
};

export function StatusBar({
  connectionState,
  activeTool,
  readOnly,
  zoom,
  nodeCount,
  selectedCount,
}: StatusBarProps) {
  const conn = CONNECTION_LABELS[connectionState];

  return (
    <footer className="h-7 shrink-0 border-t border-[var(--border)] bg-[var(--bg-panel)] px-3 flex items-center justify-between gap-4 text-[11px] text-[var(--text-secondary)]">
      <div className="flex items-center gap-2 shrink-0">
        <span
          data-testid="connection-status"
          data-state={connectionState}
          className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]"
        >
          <span aria-hidden="true" className={`w-2 h-2 rounded-full ${conn.dotClass}`} />
          <span>{conn.label}</span>
        </span>
      </div>

      <p className="truncate text-center">
        {readOnly ? 'Read-only Viewer mode — panning, zooming and PNG export enabled' : TOOL_HINTS[activeTool]}
      </p>

      <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
        <span>{selectedCount > 0 ? `${selectedCount} selected` : `${nodeCount} layers`}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </footer>
  );
}
