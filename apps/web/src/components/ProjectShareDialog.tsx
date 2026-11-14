'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2 } from 'lucide-react';
import type { Role } from '@nova/shared';
import { Badge, Button, Dialog, useToast } from '@nova/ui';
import { NovaApiError, apiClient } from '../lib/api';

export interface ProjectShareDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  canManageMembers: boolean;
  currentUserId?: string;
}

const ROLE_OPTIONS: Role[] = ['OWNER', 'EDITOR', 'VIEWER'];

export function ProjectShareDialog({
  open,
  onClose,
  projectId,
  projectName,
  canManageMembers,
  currentUserId,
}: ProjectShareDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const shareUrl =
    typeof window !== 'undefined' ? window.location.href : `/project/${projectId}`;

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => apiClient.listProjectMembers(projectId),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
      setCopiedLink(false);
    }
  }, [open, queryClient, projectId]);

  const setOverrideMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role | null }) =>
      apiClient.setProjectMemberRole(projectId, userId, { role }),
    onSuccess: async (updated) => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      pushToast({
        title: 'Project permissions updated',
        description: `${updated.name} now has ${updated.effectiveRole} access on this design.`,
        tone: 'success',
      });
    },
    onError: (err) => {
      const msg =
        err instanceof NovaApiError ? err.message : 'Unable to update project permissions.';
      setActionError(msg);
      pushToast({ title: 'Permission update failed', description: msg, tone: 'danger' });
    },
  });

  async function handleCopyLink() {
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setCopiedLink(true);
      pushToast({ title: 'Project link copied', tone: 'success' });
    } catch {
      setCopiedLink(false);
    }
  }

  const members = membersQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        setActionError(null);
        onClose();
      }}
      title={`Share — ${projectName}`}
      description="Copy the project link or set per-project role overrides for workspace members."
      className="max-w-xl w-full"
    >
      <div className="flex flex-col gap-5">
        {actionError ? (
          <div
            role="alert"
            data-testid="project-share-error-banner"
            className="px-3 py-2.5 rounded-[var(--radius-control)] border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[13px] text-[var(--danger)]"
          >
            {actionError}
          </div>
        ) : null}

        <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-app)] p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]">
            <Link2 className="w-4 h-4 text-[var(--accent-2)]" aria-hidden="true" />
            <span>Share project link</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Project share URL"
              data-testid="project-share-url-input"
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 h-8 px-2.5 rounded-[var(--radius-control)] bg-[var(--bg-panel)] border border-[var(--border)] text-[12px] font-mono text-[var(--text-primary)]"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="copy-project-link-btn"
              onClick={() => void handleCopyLink()}
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-[var(--accent-2)]" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{copiedLink ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] m-0">
            Project access ({members.length})
          </h3>

          {membersQuery.isLoading ? (
            <p className="text-[13px] text-[var(--text-secondary)] m-0">Loading members…</p>
          ) : membersQuery.isError ? (
            <p className="text-[13px] text-[var(--danger)] m-0">
              Failed to load project permissions.
            </p>
          ) : (
            <ul className="list-none p-0 m-0 flex flex-col divide-y divide-[var(--border)] max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              {members.map((member) => {
                const selectValue = member.overrideRole ?? 'INHERIT';
                return (
                  <li
                    key={member.userId}
                    data-testid={`project-member-row-${member.userId}`}
                    className="px-3 py-2.5 flex items-center justify-between gap-3 bg-[var(--bg-app)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] m-0 truncate">
                        {member.name}
                        {member.userId === currentUserId ? (
                          <span className="ml-1.5 text-[11px] text-[var(--text-secondary)]">
                            (You)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[12px] text-[var(--text-secondary)] m-0 truncate">
                        {member.email} · Workspace: {member.workspaceRole}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        data-testid={`project-member-effective-${member.userId}`}
                        variant={member.effectiveRole === 'OWNER' ? 'accent' : 'neutral'}
                      >
                        {member.effectiveRole}
                      </Badge>

                      {canManageMembers ? (
                        <select
                          aria-label={`Project role for ${member.name}`}
                          data-testid={`project-member-select-${member.userId}`}
                          value={selectValue}
                          disabled={setOverrideMutation.isPending}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setOverrideMutation.mutate({
                              userId: member.userId,
                              role: nextVal === 'INHERIT' ? null : (nextVal as Role),
                            });
                          }}
                          className="h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-primary)] border border-[var(--border)] focus:border-[var(--accent-2)]"
                        >
                          <option value="INHERIT">Inherit ({member.workspaceRole})</option>
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              Override: {r}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
