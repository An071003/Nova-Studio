'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Circle,
  Download,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { Role, ToolId } from '@nova/shared';
import type { RemotePresence } from '@nova/editor-core';
import { Badge, Button, cn } from '@nova/ui';
import { NovaLogo } from '../NovaLogo';

export interface OnlineCollaborator {
  id: string;
  name: string;
  color: string;
  isSelf?: boolean;
}

import { History, Share2 } from 'lucide-react';

export interface TopBarProps {
  projectName: string;
  role: Role;
  readOnly: boolean;
  canRenameProject: boolean;
  activeTool: ToolId;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  exporting: boolean;
  currentUser: { id: string; name: string; color: string } | null;
  remotePresences: RemotePresence[];
  onSelectTool: (tool: ToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelection: () => void;
  onRenameProject: (nextName: string) => Promise<void>;
  onOpenShare?: () => void;
  onOpenVersions?: () => void;
  onExportPng: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

const TOOL_ITEMS: Array<{
  id: ToolId;
  label: string;
  shortcut: string;
  editRequired: boolean;
  Icon: typeof MousePointer2;
}> = [
  { id: 'select', label: 'Select', shortcut: 'V', editRequired: false, Icon: MousePointer2 },
  { id: 'frame', label: 'Frame', shortcut: 'F', editRequired: true, Icon: Frame },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', editRequired: true, Icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', editRequired: true, Icon: Circle },
  { id: 'line', label: 'Line', shortcut: 'L', editRequired: true, Icon: Minus },
  { id: 'text', label: 'Text', shortcut: 'T', editRequired: true, Icon: Type },
  { id: 'hand', label: 'Hand pan', shortcut: 'H', editRequired: false, Icon: Hand },
];

export function TopBar({
  projectName,
  role,
  readOnly,
  canRenameProject,
  activeTool,
  canUndo,
  canRedo,
  hasSelection,
  exporting,
  currentUser,
  remotePresences,
  onSelectTool,
  onUndo,
  onRedo,
  onDeleteSelection,
  onRenameProject,
  onOpenShare,
  onOpenVersions,
  onExportPng,
}: TopBarProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(projectName);
  const [savingTitle, setSavingTitle] = useState(false);

  const collaborators: OnlineCollaborator[] = [];
  const seenUserIds = new Set<string>();
  for (const remote of remotePresences) {
    const u = remote.presence.user;
    if (seenUserIds.has(u.id)) continue;
    seenUserIds.add(u.id);
    collaborators.push({ id: u.id, name: u.name, color: u.color, isSelf: false });
  }
  if (currentUser && !seenUserIds.has(currentUser.id)) {
    collaborators.push({ ...currentUser, isSelf: true });
  }

  const handleTitleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === projectName) {
      setEditingTitle(false);
      setDraftTitle(projectName);
      return;
    }
    setSavingTitle(true);
    try {
      await onRenameProject(trimmed);
      setEditingTitle(false);
    } finally {
      setSavingTitle(false);
    }
  };

  return (
    <header className="h-12 shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 flex items-center justify-between gap-3">
      {/* Left: Back link, Brand, Editable Project Name, Role */}
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <NovaLogo compact />

        <span aria-hidden="true" className="text-[var(--border-strong)] select-none">
          /
        </span>

        {editingTitle ? (
          <form onSubmit={handleTitleSubmit} className="flex items-center gap-1">
            <input
              aria-label="Project name"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => {
                if (!savingTitle) {
                  setEditingTitle(false);
                  setDraftTitle(projectName);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditingTitle(false);
                  setDraftTitle(projectName);
                }
              }}
              autoFocus
              maxLength={120}
              disabled={savingTitle}
              className="h-7 px-2 rounded-[var(--radius-control)] bg-[var(--bg-elevated)] border border-[var(--accent)] text-[13px] font-medium text-[var(--text-primary)] w-44"
            />
          </form>
        ) : (
          <button
            type="button"
            disabled={!canRenameProject}
            onClick={() => {
              setDraftTitle(projectName);
              setEditingTitle(true);
            }}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-control)] text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:cursor-default disabled:hover:bg-transparent truncate max-w-[200px]"
            title={canRenameProject ? 'Click to rename project' : projectName}
          >
            <span className="truncate">{projectName}</span>
            {canRenameProject ? (
              <Pencil className="w-3 h-3 shrink-0 text-[var(--text-secondary)]" />
            ) : null}
          </button>
        )}

        <Badge variant={role === 'OWNER' ? 'accent' : role === 'EDITOR' ? 'neutral' : 'warning'}>
          {role}
        </Badge>
      </div>

      {/* Center: Canvas Tools */}
      <div
        role="toolbar"
        aria-label="Canvas tools"
        className="flex items-center gap-1 px-1.5 py-1 rounded-[var(--radius-panel)] bg-[var(--bg-app)] border border-[var(--border)]"
      >
        {TOOL_ITEMS.map(({ id, label, shortcut, editRequired, Icon }) => {
          const isActive = activeTool === id;
          const isDisabled = readOnly && editRequired;
          return (
            <button
              key={id}
              type="button"
              disabled={isDisabled}
              aria-label={`${label} (${shortcut})`}
              aria-pressed={isActive}
              title={`${label} (${shortcut})`}
              onClick={() => onSelectTool(id)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-control)] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                isActive
                  ? 'bg-[var(--accent-solid)] text-[var(--text-on-accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
              )}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">{label}</span>
              <kbd className="hidden 2xl:inline text-[10px] opacity-75 font-mono">{shortcut}</kbd>
            </button>
          );
        })}
      </div>

      {/* Right: Online Presence / Undo / Redo / Delete / Export */}
      <div className="flex items-center gap-1.5">
        <div
          data-testid="presence-avatars"
          aria-label="Online collaborators"
          className="hidden sm:flex items-center -space-x-1.5 mr-1"
        >
          {collaborators.slice(0, 5).map((person) => (
            <span
              key={person.id}
              data-testid={`presence-avatar-${person.id}`}
              title={person.isSelf ? `${person.name} (You)` : person.name}
              style={{ backgroundColor: person.color }}
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-[var(--bg-app)] ring-2 ring-[var(--bg-panel)] select-none"
            >
              {getInitials(person.name)}
            </span>
          ))}
          {collaborators.length > 5 ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] ring-2 ring-[var(--bg-panel)]">
              +{collaborators.length - 5}
            </span>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="sm"
          disabled={readOnly || !canUndo}
          onClick={onUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          className="px-2"
        >
          <Undo2 className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={readOnly || !canRedo}
          onClick={onRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          className="px-2"
        >
          <Redo2 className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={readOnly || !hasSelection}
          onClick={onDeleteSelection}
          aria-label="Delete selected"
          title="Delete selected (Del)"
          className="px-2"
        >
          <Trash2 className="w-4 h-4" />
        </Button>

        <div aria-hidden="true" className="w-px h-5 bg-[var(--border)] mx-1" />

        {onOpenVersions ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenVersions}
            data-testid="version-history-btn"
            aria-label="Version history"
          >
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            <span>History</span>
          </Button>
        ) : null}

        {onOpenShare ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenShare}
            data-testid="project-share-btn"
            aria-label="Share"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Share</span>
          </Button>
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          loading={exporting}
          onClick={onExportPng}
          aria-label="Export PNG"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </Button>
      </div>
    </header>
  );
}
