'use client';

import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
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
  Plus,
  Square,
  Type,
  Unlock,
  Upload,
} from 'lucide-react';
import type { AssetDto, CanvasNode, NodeType } from '@nova/shared';
import { Button, cn } from '@nova/ui';

export interface LayersPanelProps {
  nodes: CanvasNode[];
  selectedIds: string[];
  readOnly: boolean;
  assets?: AssetDto[];
  uploadingAsset?: boolean;
  onSelectNode: (id: string, additive: boolean) => void;
  onRenameNode: (id: string, name: string) => void;
  onToggleVisible: (node: CanvasNode) => void;
  onToggleLocked: (node: CanvasNode) => void;
  onReorderNode: (nodeId: string, direction: 'forward' | 'backward') => void;
  onUploadAssetFile?: (file: File) => void;
  onInsertAsset?: (asset: AssetDto) => void;
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
  assets = [],
  uploadingAsset = false,
  onSelectNode,
  onRenameNode,
  onToggleVisible,
  onToggleLocked,
  onReorderNode,
  onUploadAssetFile,
  onInsertAsset,
}: LayersPanelProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('layers');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [isDropzoneHover, setIsDropzoneHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3"
      >
        {!readOnly ? (
          <div
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setIsDropzoneHover(true);
            }}
            onDragLeave={() => setIsDropzoneHover(false)}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setIsDropzoneHover(false);
              const file = e.dataTransfer.files?.[0];
              if (file) {
                onUploadAssetFile?.(file);
              }
            }}
            className={cn(
              'rounded-[var(--radius-panel)] border border-dashed p-3 text-center transition-colors',
              isDropzoneHover
                ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                : 'border-[var(--border-strong)] bg-[var(--bg-app)]/50',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              data-testid="asset-file-input"
              aria-label="Upload image asset"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onUploadAssetFile?.(file);
                }
                e.target.value = '';
              }}
            />
            <Upload className="w-5 h-5 mx-auto mb-1.5 text-[var(--text-secondary)]" />
            <p className="text-[12px] font-medium text-[var(--text-primary)]">Project Assets</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              PNG, JPEG, WebP, GIF or SVG up to 25 MB.
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={uploadingAsset}
              onClick={() => fileInputRef.current?.click()}
              className="mt-2.5 w-full"
            >
              {uploadingAsset ? 'Uploading…' : 'Upload image'}
            </Button>
          </div>
        ) : null}

        {assets.length === 0 ? (
          <p className="text-[11px] text-[var(--text-secondary)] text-center py-2">
            No ready assets yet. Drop an image onto the canvas or upload one above.
          </p>
        ) : (
          <ul role="list" aria-label="Uploaded project assets" className="flex flex-col gap-1.5">
            {assets.map((asset) => {
              const sizeKb = Math.max(1, Math.round(asset.sizeBytes / 1024));
              return (
                <li
                  key={asset.id}
                  data-testid={`asset-item-${asset.id}`}
                  data-status={asset.status}
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    if (readOnly) return;
                    e.dataTransfer.setData('application/x-nova-asset', JSON.stringify(asset));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-app)] p-2 text-[11px]"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                        {asset.width ?? '?'}×{asset.height ?? '?'}
                      </p>
                      <p className="truncate text-[10px] text-[var(--text-secondary)]">
                        {asset.mimeType.replace('image/', '').toUpperCase()} · {sizeKb} KB
                      </p>
                    </div>
                  </div>
                  {!readOnly ? (
                    <button
                      type="button"
                      aria-label={`Insert asset ${asset.id} on canvas`}
                      onClick={() => onInsertAsset?.(asset)}
                      className="h-6 px-2 inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] hover:border-[var(--accent)] cursor-pointer shrink-0"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
