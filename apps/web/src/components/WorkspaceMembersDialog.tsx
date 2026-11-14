'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import {
  CreateInviteSchema,
  ROLES,
  can,
  type InviteResponse,
  type Role,
  type WorkspaceSummary,
} from '@nova/shared';
import { Badge, Button, Dialog, Input, Select, useToast } from '@nova/ui';
import { NovaApiError, apiClient } from '../lib/api';

export interface WorkspaceMembersDialogProps {
  open: boolean;
  onClose: () => void;
  workspace: Pick<WorkspaceSummary, 'id' | 'name' | 'role'>;
  currentUserId: string | undefined;
}

export function WorkspaceMembersDialog({
  open,
  onClose,
  workspace,
  currentUserId,
}: WorkspaceMembersDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('EDITOR');
  const [inviteError, setInviteError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestInvite, setLatestInvite] = useState<InviteResponse | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const canManageMembers = can(workspace.role, 'workspace.manage_members');
  const canInvite = can(workspace.role, 'workspace.invite');

  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => apiClient.listWorkspaceMembers(workspace.id),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] });
    }
  }, [open, queryClient, workspace.id]);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiClient.updateWorkspaceMemberRole(workspace.id, userId, { role }),
    onSuccess: async ({ member }) => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({
        title: 'Member role updated',
        description: `${member.name} is now ${member.role}.`,
        tone: 'success',
      });
    },
    onError: (err) => {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to update member role.';
      setActionError(msg);
      pushToast({ title: 'Role update failed', description: msg, tone: 'danger' });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => apiClient.removeWorkspaceMember(workspace.id, userId),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['workspace-members', workspace.id] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({ title: 'Member removed', tone: 'info' });
    },
    onError: (err) => {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to remove member.';
      setActionError(msg);
      pushToast({ title: 'Remove failed', description: msg, tone: 'danger' });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: (dto: { email?: string; role: Role }) =>
      apiClient.createWorkspaceInvite(workspace.id, dto),
    onSuccess: (res) => {
      setActionError(null);
      setInviteError(undefined);
      setInviteEmail('');
      setLatestInvite(res);
      setCopiedInvite(false);
      pushToast({ title: 'Invite link created', tone: 'success' });
    },
    onError: (err) => {
      const msg = err instanceof NovaApiError ? err.message : 'Unable to create invite link.';
      setInviteError(msg);
    },
  });

  function handleCreateInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedEmail = inviteEmail.trim();
    const parsed = CreateInviteSchema.safeParse({
      email: trimmedEmail.length > 0 ? trimmedEmail : undefined,
      role: inviteRole,
    });
    if (!parsed.success) {
      setInviteError('Enter a valid email address or leave blank for a shareable link.');
      return;
    }
    setInviteError(undefined);
    createInviteMutation.mutate(parsed.data);
  }

  async function handleCopyInvite() {
    if (!latestInvite) return;
    try {
      await navigator.clipboard?.writeText(latestInvite.inviteUrl);
      setCopiedInvite(true);
      pushToast({ title: 'Invite link copied', tone: 'success' });
    } catch {
      setCopiedInvite(false);
    }
  }

  const members = membersQuery.data?.members ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        setActionError(null);
        setInviteError(undefined);
        onClose();
      }}
      title={`Members — ${workspace.name}`}
      description="Manage collaborator permissions or generate an invitation link."
      className="max-w-xl w-full"
    >
      <div className="flex flex-col gap-5">
        {actionError ? (
          <div
            role="alert"
            data-testid="members-error-banner"
            className="px-3 py-2.5 rounded-[var(--radius-control)] border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[13px] text-[var(--danger)]"
          >
            {actionError}
          </div>
        ) : null}

        {canInvite ? (
          <form
            onSubmit={handleCreateInvite}
            className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-app)] p-3.5 flex flex-col gap-3"
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]">
              <Link2 className="w-4 h-4 text-[var(--accent-2)]" aria-hidden="true" />
              <span>Invite teammate</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px] gap-2.5 items-start">
              <Input
                id="invite-email"
                type="email"
                label="Email (optional)"
                placeholder="teammate@company.com"
                value={inviteEmail}
                error={inviteError}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  if (inviteError) setInviteError(undefined);
                }}
              />
              <Select
                id="invite-role"
                label="Role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                data-testid="create-invite-btn"
                loading={createInviteMutation.isPending}
              >
                {createInviteMutation.isPending ? 'Generating…' : 'Create invite link'}
              </Button>
            </div>

            {latestInvite ? (
              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                <input
                  readOnly
                  aria-label="Generated invite URL"
                  data-testid="invite-url-input"
                  value={latestInvite.inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 h-8 px-2.5 rounded-[var(--radius-control)] bg-[var(--bg-panel)] border border-[var(--border)] text-[12px] font-mono text-[var(--text-primary)]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleCopyInvite()}
                >
                  {copiedInvite ? (
                    <Check className="w-3.5 h-3.5 text-[var(--accent-2)]" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{copiedInvite ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] m-0">
            Workspace members ({members.length})
          </h3>

          {membersQuery.isLoading ? (
            <p className="text-[13px] text-[var(--text-secondary)] m-0">Loading members…</p>
          ) : membersQuery.isError ? (
            <p className="text-[13px] text-[var(--danger)] m-0">Failed to load members.</p>
          ) : (
            <ul className="list-none p-0 m-0 flex flex-col divide-y divide-[var(--border)] max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              {members.map((member) => {
                const canRemove =
                  canManageMembers || (currentUserId !== undefined && member.userId === currentUserId);
                return (
                  <li
                    key={member.userId}
                    data-testid={`member-row-${member.userId}`}
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
                        {member.email}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canManageMembers ? (
                        <select
                          aria-label={`Role for ${member.name}`}
                          data-testid={`member-role-select-${member.userId}`}
                          value={member.role}
                          disabled={updateRoleMutation.isPending}
                          onChange={(e) =>
                            updateRoleMutation.mutate({
                              userId: member.userId,
                              role: e.target.value as Role,
                            })
                          }
                          className="h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-primary)] border border-[var(--border)] focus:border-[var(--accent-2)]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant={member.role === 'OWNER' ? 'accent' : 'neutral'}>
                          {member.role}
                        </Badge>
                      )}

                      {canRemove ? (
                        <button
                          type="button"
                          aria-label={`Remove ${member.name}`}
                          data-testid={`member-remove-btn-${member.userId}`}
                          disabled={removeMemberMutation.isPending}
                          onClick={() => removeMemberMutation.mutate(member.userId)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--bg-elevated)] cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
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
