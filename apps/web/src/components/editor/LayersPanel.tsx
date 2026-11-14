'use client';

import { useState, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  EyeOff,
  Folder,
  Frame,
  Image as ImageIcon,
  Lock,
  Minus,
  Square,
  Type,
  Unlock,
} from 'lucide-react';
import type { CanvasNode, NodeType } from '@nova/shared';
import { cn } from '@nova/ui';

export interface LayersPanelProps {
  nodes: CanvasNode[];
  selectedIds: string[];
  readOnly: boolean;
  onSelectNode: (id: string, additive: boolean) => void;
  onRenameNode: (id: string, name: string) => void;
  onToggleVisible: (node: CanvasNode) => void;
  onToggleLocked: (node: CanvasNode) => void;
  onReorderNode: (nodeId: string, direction: 'forward' | 'backward') => void;
}

type SidebarTab = 'layers' | 'assets';

function NodeTypeIcon({ type }: { type: NodeType }) {
  const cls = 'w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)]';
  switch (type) {
    case 'frame':
      return <Frame className={cls} aria-hidden="true" />;
    case 'group':
      return <Folder className={cls} aria-hidden="true" />;
    case 'ellipse':
      return <Circle className={cls} aria-hidden="true" />;
    case 'line':
      return <Minus className={cls} aria-hidden="true" />;
    case 'text':
      return <Type className={cls} aria-hidden="true" />;
    case 'image':
      return <ImageIcon className={cls} aria-hidden="true" />;
    case 'rect':
    default:
      return <Square className={cls} aria-hidden="true" />;
  }
}

export function LayersPanel({
  nodes,
  selectedIds,
  readOnly,
  onSelectNode,
  onRenameNode,
  onToggleVisible,
  onToggleLocked,
  onReorderNode,
}: LayersPanelProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('layers');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const selectedSet = new Set(selectedIds);
  // Display top-most visual layer first (scene graph order is back-to-front)
  const displayNodes = [...nodes].reverse();

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab((prev) => (prev === 'layers' ? 'assets' : 'layers'));
    }
  };

  return (
    <aside
      aria-label="Layers and Assets"
      className="w-60 shrink-0 border-r border-[var(--border)] bg-[var(--bg-panel)] flex flex-col min-h-0"
    >
      <div
        role="tablist"
        aria-label="Sidebar panels"
        onKeyDown={handleTabKeyDown}
        className="h-10 shrink-0 border-b border-[var(--border)] px-2 flex items-stretch gap-1"
      >
        <button
          id="tab-layers"
          type="button"
          role="tab"
          aria-selected={activeTab === 'layers'}
          onClick={() => setActiveTab('layers')}
          className={cn(
            'px-3 text-[12px] font-medium transition-colors cursor-pointer',
            activeTab === 'layers'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          Layers ({nodes.length})
        </button>
        <button
          id="tab-assets"
          type="button"
          role="tab"
          aria-selected={activeTab === 'assets'}
          onClick={() => setActiveTab('assets')}
          className={cn(
            'px-3 text-[12px] font-medium transition-colors cursor-pointer',
            activeTab === 'assets'
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          )}
        >
          Assets
        </button>
      </div>

      {/* Layers Tab Panel */}
      <div
        role="tabpanel"
        aria-labelledby="tab-layers"
        hidden={activeTab !== 'layers'}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {displayNodes.length === 0 ? (
          <div className="p-4 text-[12px] text-[var(--text-secondary)]">
            No layers yet. Pick a tool above (`F`, `R`, `O`, `L`, `T`) and drag on the canvas to
            create your first layer.
          </div>
        ) : (
          <ul role="list" aria-label="Canvas layers" className="p-1.5 flex flex-col gap-0.5">
            {displayNodes.map((node) => {
              const isSelected = selectedSet.has(node.id);
              const isRenaming = renamingId === node.id;

              return (
                <li
                  key={node.id}
                  data-testid={`layer-row-${node.id}`}
                  className={cn(
                    'group flex items-center gap-1.5 h-8 px-2 rounded-[var(--radius-control)] text-[12px] transition-colors',
                    node.parentId ? 'pl-5' : '',
                    isSelected
                      ? 'bg-[var(--accent)]/15 text-[var(--text-primary)] ring-1 ring-inset ring-[var(--accent)]/50'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]',
                    !node.visible ? 'opacity-50' : '',
                  )}
                >
                  <NodeTypeIcon type={node.type} />

                  {isRenaming ? (
                    <input
                      aria-label={`Rename ${node.name}`}
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => {
                        const trimmed = draftName.trim();
                        if (trimmed && trimmed !== node.name) {
                          onRenameNode(node.id, trimmed);
                        }
                        setRenamingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const trimmed = draftName.trim();
                          if (trimmed && trimmed !== node.name) {
                            onRenameNode(node.id, trimmed);
                          }
                          setRenamingId(null);
                        } else if (e.key === 'Escape') {
                          setRenamingId(null);
                        }
                      }}
                      className="flex-1 min-w-0 h-6 px-1.5 rounded bg-[var(--bg-app)] border border-[var(--accent)] text-[12px] text-[var(--text-primary)]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => onSelectNode(node.id, e.shiftKey)}
                      onDoubleClick={() => {
                        if (readOnly) return;
                        setDraftName(node.name);
                        setRenamingId(node.id);
                      }}
                      className="flex-1 min-w-0 text-left truncate cursor-pointer py-1"
                    >
                      {node.name}
                    </button>
                  )}

                  {!readOnly ? (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-75 group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={`Move ${node.name} forward`}
                        title="Bring forward"
                        onClick={() => onReorderNode(node.id, 'forward')}
                        className="p-0.5 rounded hover:bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${node.name} backward`}
                        title="Send backward"
                        onClick={() => onReorderNode(node.id, 'backward')}
                        className="p-0.5 rounded hover:bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
                        title={node.visible ? 'Hide layer' : 'Show layer'}
                        onClick={() => onToggleVisible(node)}
                        className="p-0.5 rounded hover:bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {node.visible ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
                        title={node.locked ? 'Unlock layer' : 'Lock layer'}
                        onClick={() => onToggleLocked(node)}
                        className="p-0.5 rounded hover:bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {node.locked ? (
                          <Lock className="w-3.5 h-3.5 text-[var(--warning)]" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Assets Tab Panel */}
      <div
        role="tabpanel"
        aria-labelledby="tab-assets"
        hidden={activeTab !== 'assets'}
        className="flex-1 min-h-0 overflow-y-auto p-3"
      >
        <div className="rounded-[var(--radius-panel)] border border-dashed border-[var(--border-strong)] p-4 text-center">
          <ImageIcon className="w-6 h-6 mx-auto mb-2 text-[var(--text-secondary)]" />
          <p className="text-[12px] font-medium text-[var(--text-primary)]">Project Assets</p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Asset uploads (PNG, JPEG, WebP, SVG) and canvas drag-and-drop connect in P1-T15.
          </p>
        </div>
      </div>
    </aside>
  );
}
