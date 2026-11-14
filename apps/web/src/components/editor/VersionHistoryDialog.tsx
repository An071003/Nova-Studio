'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Eye, History, RotateCcw, X } from 'lucide-react';
import type { VersionPreview, VersionSummary } from '@nova/shared';
import { Badge, Button, Input, useToast } from '@nova/ui';
import { NovaApiError, apiClient } from '../../lib/api';

export interface VersionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  canCreateVersion: boolean;
  canRestoreVersion: boolean;
  activePreviewVersionId: string | null;
  getEncodedDocState: () => string | null;
  onPreviewVersion: (preview: VersionPreview) => void;
  onVersionRestored: () => void;
}

function formatVersionTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function VersionHistoryDialog({
  open,
  onClose,
  projectId,
  canCreateVersion,
  canRestoreVersion,
  activePreviewVersionId,
  getEncodedDocState,
  onPreviewVersion,
  onVersionRestored,
}: VersionHistoryDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | undefined>(undefined);
  const [confirmTarget, setConfirmTarget] = useState<VersionSummary | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  const versionsQuery = useQuery({
    queryKey: ['project-versions', projectId],
    queryFn: () => apiClient.listProjectVersions(projectId),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      setConfirmTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['project-versions', projectId] });
    }
  }, [open, projectId, queryClient]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmTarget) {
          setConfirmTarget(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmTarget, onClose]);

  const createMutation = useMutation({
    mutationFn: async (trimmedLabel: string) => {
      const stateBase64 = getEncodedDocState();
      return apiClient.createProjectVersion(projectId, {
        label: trimmedLabel,
        ...(stateBase64 ? { stateBase64 } : {}),
      });
    },
    onSuccess: async ({ version }) => {
      setLabel('');
      setLabelError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['project-versions', projectId] });
      pushToast({
        title: `Saved version "${version.label}"`,
        tone: 'success',
      });
    },
    onError: (err) => {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to create version.';
      setLabelError(msg);
      pushToast({ title: 'Save version failed', description: msg, tone: 'danger' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const currentStateBase64 = getEncodedDocState();
      return apiClient.restoreProjectVersion(
        projectId,
        versionId,
        currentStateBase64 ? { currentStateBase64 } : {},
      );
    },
    onSuccess: async ({ version }) => {
      setConfirmTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['project-versions', projectId] });
      onVersionRestored();
      pushToast({
        title: `Restored to "${version.label}"`,
        description: 'Previous state saved automatically as "Before restore".',
        tone: 'success',
      });
    },
    onError: (err) => {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to restore version.';
      pushToast({ title: 'Restore failed', description: msg, tone: 'danger' });
    },
  });

  if (!open) {
    return null;
  }

  const handleSaveSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setLabelError('Enter a version name.');
      return;
    }
    setLabelError(undefined);
    createMutation.mutate(trimmed);
  };

  const handlePreviewClick = async (versionId: string) => {
    setLoadingPreviewId(versionId);
    try {
      const preview = await apiClient.getVersionPreview(projectId, versionId);
      onPreviewVersion(preview);
    } catch (err) {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to load preview.';
      pushToast({ title: 'Preview failed', description: msg, tone: 'danger' });
    } finally {
      setLoadingPreviewId(null);
    }
  };

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <aside
      aria-label="Version history"
      data-testid="version-history-drawer"
      className="fixed top-12 right-0 bottom-7 z-40 w-88 max-w-full bg-[var(--bg-panel)] border-l border-[var(--border)] shadow-[var(--shadow-panel)] flex flex-col"
    >
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--accent-2)]" aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)] m-0">
            Version history
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {canCreateVersion ? (
        <form
          onSubmit={handleSaveSubmit}
          className="p-3 border-b border-[var(--border)] bg-[var(--bg-app)] flex flex-col gap-2 shrink-0"
        >
          <Input
            id="version-label-input"
            label="Save named checkpoint"
            placeholder="e.g. v1 — Hero layout"
            value={label}
            error={labelError}
            onChange={(e) => {
              setLabel(e.target.value);
              if (labelError) setLabelError(undefined);
            }}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              data-testid="create-version-submit-btn"
              loading={createMutation.isPending}
            >
              Save version
            </Button>
          </div>
        </form>
      ) : null}

      {confirmTarget ? (
        <div
          role="alertdialog"
          aria-label="Confirm restore version"
          data-testid="restore-confirm-panel"
          className="m-3 p-3 rounded-[var(--radius-control)] border border-[var(--warning)]/50 bg-[var(--warning)]/10 flex flex-col gap-2.5 shrink-0"
        >
          <p className="text-[12px] text-[var(--text-primary)] m-0">
            Restore canvas to <strong>{confirmTarget.label}</strong>? Current changes will be
            backed up as an auto-version named <em>Before restore</em>.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="cancel-restore-btn"
              disabled={restoreMutation.isPending}
              onClick={() => setConfirmTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              data-testid="confirm-restore-btn"
              loading={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(confirmTarget.id)}
            >
              Confirm restore
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {versionsQuery.isLoading ? (
          <p className="text-[13px] text-[var(--text-secondary)] m-0">Loading versions…</p>
        ) : versionsQuery.isError ? (
          <p className="text-[13px] text-[var(--danger)] m-0">Failed to load versions.</p>
        ) : versions.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[var(--text-secondary)]">
            No saved versions yet.
          </div>
        ) : (
          <ul
            data-testid="version-history-list"
            className="list-none p-0 m-0 flex flex-col gap-2"
          >
            {versions.map((v) => {
              const isPreviewing = activePreviewVersionId === v.id;
              return (
                <li
                  key={v.id}
                  data-testid={`version-item-${v.id}`}
                  className={`p-3 rounded-[var(--radius-control)] border transition-colors ${
                    isPreviewing
                      ? 'border-[var(--accent-2)] bg-[var(--accent-2)]/10'
                      : 'border-[var(--border)] bg-[var(--bg-app)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] m-0 truncate">
                        {v.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] flex items-center gap-1 m-0">
                        <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{formatVersionTimestamp(v.createdAt)}</span>
                      </p>
                    </div>
                    {v.isAuto ? <Badge variant="neutral">Auto</Badge> : null}
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid={`version-preview-btn-${v.id}`}
                      loading={loadingPreviewId === v.id}
                      onClick={() => void handlePreviewClick(v.id)}
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isPreviewing ? 'Previewing' : 'Preview'}</span>
                    </Button>

                    {canRestoreVersion ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-testid={`version-restore-btn-${v.id}`}
                        onClick={() => setConfirmTarget(v)}
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Restore</span>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
