'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, LogOut, Plus } from 'lucide-react';
import { CreateWorkspaceSchema } from '@nova/shared';
import { Badge, Button, Card, Dialog, Input, useToast } from '@nova/ui';
import { NovaLogo } from '../../components/NovaLogo';
import { NovaApiError, apiClient } from '../../lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState<string | undefined>(undefined);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.getMe(),
  });

  useEffect(() => {
    if (meQuery.error instanceof NovaApiError && meQuery.error.status === 401) {
      router.replace('/login');
    }
  }, [meQuery.error, router]);

  const workspaces = meQuery.data?.workspaces ?? [];
  const activeWorkspace =
    workspaces.find((w) => w.id === selectedWorkspaceId) ?? workspaces[0] ?? null;

  const projectsQuery = useQuery({
    queryKey: ['projects', activeWorkspace?.id],
    queryFn: () => apiClient.listProjects(activeWorkspace!.id),
    enabled: Boolean(activeWorkspace?.id),
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: (name: string) => apiClient.createWorkspace({ name }),
    onSuccess: async ({ workspace }) => {
      setWorkspaceModalOpen(false);
      setWorkspaceName('');
      setWorkspaceError(undefined);
      setSelectedWorkspaceId(workspace.id);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({ title: 'Workspace created', description: workspace.name, tone: 'success' });
    },
    onError: (err) => {
      setWorkspaceError(
        err instanceof NovaApiError ? err.message : 'Failed to create workspace.',
      );
    },
  });

  async function handleLogout() {
    await apiClient.logout();
    queryClient.clear();
    router.replace('/login');
  }

  function handleCreateWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = CreateWorkspaceSchema.safeParse({ name: workspaceName });
    if (!parsed.success) {
      setWorkspaceError('Workspace name is required (1–100 characters).');
      return;
    }
    setWorkspaceError(undefined);
    createWorkspaceMutation.mutate(parsed.data.name);
  }

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <p className="text-[14px] text-[var(--text-secondary)]">Loading studio workspace…</p>
      </main>
    );
  }

  if (meQuery.isError) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--bg-app)] p-6">
        <Card className="p-6 max-w-md w-full flex flex-col gap-3">
          <h1 className="text-[18px] font-semibold m-0">Session unavailable</h1>
          <p className="text-[13px] text-[var(--text-secondary)] m-0">
            {meQuery.error instanceof NovaApiError
              ? meQuery.error.message
              : 'Unable to load your profile.'}
          </p>
          <div className="flex gap-2">
            <Button onClick={() => router.replace('/login')}>Go to sign in</Button>
            <Button variant="secondary" onClick={() => void meQuery.refetch()}>
              Retry
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  const user = meQuery.data?.user;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
      <header className="h-14 border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 flex items-center justify-between gap-4">
        <NovaLogo />
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-[var(--text-primary)] font-medium">{user.name}</span>
              <span className="text-[var(--text-secondary)] hidden sm:inline">({user.email})</span>
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sign out</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside
          aria-label="Workspaces"
          className="w-64 border-r border-[var(--border)] bg-[var(--bg-panel)] p-4 flex flex-col gap-4 shrink-0"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] m-0">
              Workspaces
            </h2>
            <Button
              variant="ghost"
              size="sm"
              aria-label="New workspace"
              onClick={() => setWorkspaceModalOpen(true)}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>

          <nav aria-label="Workspace list" className="flex flex-col gap-1">
            {workspaces.length === 0 ? (
              <p className="text-[13px] text-[var(--text-secondary)] m-0 py-2">
                No workspaces yet.
              </p>
            ) : (
              workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspace?.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setSelectedWorkspaceId(ws.id)}
                    className={`w-full text-left px-3 py-2 rounded-[var(--radius-control)] text-[13px] flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[var(--accent)]/15 text-[var(--text-primary)] border border-[var(--accent)]/40'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent'
                    }`}
                  >
                    <span className="truncate font-medium">{ws.name}</span>
                    <Badge variant={ws.role === 'OWNER' ? 'accent' : 'neutral'}>
                      {ws.role}
                    </Badge>
                  </button>
                );
              })
            )}
          </nav>
        </aside>

        <main className="flex-1 p-6 overflow-y-auto">
          {!activeWorkspace ? (
            <Card className="p-8 max-w-lg mx-auto mt-10 flex flex-col items-start gap-4">
              <h1 className="text-[20px] font-semibold m-0">Welcome to NOVA STUDIO</h1>
              <p className="text-[14px] text-[var(--text-secondary)] m-0">
                Create your first workspace to organize designs, invite teammates, and start
                collaborating on canvas.
              </p>
              <Button onClick={() => setWorkspaceModalOpen(true)}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Create workspace</span>
              </Button>
            </Card>
          ) : (
            <div className="flex flex-col gap-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-[20px] font-semibold m-0">{activeWorkspace.name}</h1>
                  <p className="text-[13px] text-[var(--text-secondary)] m-0 mt-1">
                    Role: {activeWorkspace.role}
                  </p>
                </div>
              </div>

              {projectsQuery.isLoading ? (
                <p className="text-[14px] text-[var(--text-secondary)]">Loading projects…</p>
              ) : projectsQuery.isError ? (
                <Card className="p-6 flex items-center justify-between gap-4">
                  <p className="text-[14px] text-[var(--danger)] m-0">Failed to load projects.</p>
                  <Button variant="secondary" onClick={() => void projectsQuery.refetch()}>
                    Retry
                  </Button>
                </Card>
              ) : (projectsQuery.data?.projects.length ?? 0) === 0 ? (
                <Card className="p-8 flex flex-col items-start gap-3">
                  <FolderKanban
                    className="w-6 h-6 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <h2 className="text-[16px] font-semibold m-0">No designs yet</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] m-0">
                    Your workspace is ready. Project creation and grid tools arrive in P1-T12.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projectsQuery.data?.projects.map((project) => (
                    <Card key={project.id} className="p-4 flex flex-col gap-2">
                      <div className="aspect-[16/10] rounded-[var(--radius-control)] nova-dot-canvas border border-[var(--border)] flex items-center justify-center text-[12px] text-[var(--text-secondary)]">
                        Canvas preview
                      </div>
                      <h2 className="text-[14px] font-medium m-0 truncate">{project.name}</h2>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <Dialog
        open={workspaceModalOpen}
        onClose={() => {
          setWorkspaceModalOpen(false);
          setWorkspaceError(undefined);
        }}
        title="New workspace"
        description="Group projects and collaborate with team members."
      >
        <form onSubmit={handleCreateWorkspace} className="flex flex-col gap-4">
          <Input
            id="workspace-name"
            name="workspaceName"
            label="Workspace name"
            placeholder="Design Team"
            value={workspaceName}
            error={workspaceError}
            onChange={(e) => {
              setWorkspaceName(e.target.value);
              if (workspaceError) setWorkspaceError(undefined);
            }}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setWorkspaceModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createWorkspaceMutation.isPending}>
              {createWorkspaceMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
