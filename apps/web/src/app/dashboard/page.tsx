'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  FolderKanban,
  LogOut,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  CreateProjectSchema,
  CreateWorkspaceSchema,
  UpdateProjectSchema,
  UpdateWorkspaceSchema,
  can,
  type ProjectSummary,
} from '@nova/shared';
import { Badge, Button, Card, Dialog, Input, Select, useToast } from '@nova/ui';
import { NovaLogo } from '../../components/NovaLogo';
import { WorkspaceMembersDialog } from '../../components/WorkspaceMembersDialog';
import { NovaApiError, apiClient } from '../../lib/api';

type DesignPreset = '1920x1080' | '1080x1080' | '1080x1920' | 'custom';

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProjectThumbnail({
  projectId,
  thumbnailUrl,
  name,
}: {
  projectId: string;
  thumbnailUrl: string | null;
  name: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!thumbnailUrl) {
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    let allocatedUrl: string | null = null;

    void apiClient
      .fetchProjectThumbnailObjectUrl(projectId)
      .then((nextUrl) => {
        if (cancelled) {
          if (nextUrl) URL.revokeObjectURL(nextUrl);
          return;
        }
        allocatedUrl = nextUrl;
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setObjectUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (allocatedUrl) {
        URL.revokeObjectURL(allocatedUrl);
      }
    };
  }, [projectId, thumbnailUrl]);

  if (!objectUrl) {
    return <span>Open canvas</span>;
  }

  return (
    <img
      src={objectUrl}
      data-testid={`project-thumb-${projectId}`}
      alt={`${name} preview`}
      className="w-full h-full object-cover"
    />
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Workspace dialogs
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceError, setNewWorkspaceError] = useState<string | undefined>(undefined);

  const [renameWorkspaceOpen, setRenameWorkspaceOpen] = useState(false);
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('');
  const [renameWorkspaceError, setRenameWorkspaceError] = useState<string | undefined>(undefined);

  // Project dialogs
  const [newDesignOpen, setNewDesignOpen] = useState(false);
  const [newDesignName, setNewDesignName] = useState('');
  const [newDesignPreset, setNewDesignPreset] = useState<DesignPreset>('1920x1080');
  const [newDesignError, setNewDesignError] = useState<string | undefined>(undefined);

  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameProjectName, setRenameProjectName] = useState('');
  const [renameProjectError, setRenameProjectError] = useState<string | undefined>(undefined);

  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wsId = new URLSearchParams(window.location.search).get('workspaceId');
    if (wsId) {
      setSelectedWorkspaceId(wsId);
    }
  }, []);

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

  const filteredProjects = useMemo(() => {
    const list = projectsQuery.data?.projects ?? [];
    const term = searchQuery.trim().toLowerCase();
    if (!term) return list;
    return list.filter((p) => p.name.toLowerCase().includes(term));
  }, [projectsQuery.data?.projects, searchQuery]);

  const createWorkspaceMutation = useMutation({
    mutationFn: (name: string) => apiClient.createWorkspace({ name }),
    onSuccess: async ({ workspace }) => {
      setNewWorkspaceOpen(false);
      setNewWorkspaceName('');
      setNewWorkspaceError(undefined);
      setSelectedWorkspaceId(workspace.id);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({ title: 'Workspace created', description: workspace.name, tone: 'success' });
    },
    onError: (err) => {
      setNewWorkspaceError(
        err instanceof NovaApiError ? err.message : 'Failed to create workspace.',
      );
    },
  });

  const renameWorkspaceMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient.updateWorkspace(id, { name }),
    onSuccess: async ({ workspace }) => {
      setRenameWorkspaceOpen(false);
      setRenameWorkspaceError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({ title: 'Workspace renamed', description: workspace.name, tone: 'success' });
    },
    onError: (err) => {
      setRenameWorkspaceError(
        err instanceof NovaApiError ? err.message : 'Failed to rename workspace.',
      );
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      apiClient.createProject(workspaceId, { name }),
    onSuccess: async ({ project }) => {
      setNewDesignOpen(false);
      setNewDesignName('');
      setNewDesignError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['projects', project.workspaceId] });
      pushToast({ title: 'Design created', description: project.name, tone: 'success' });
    },
    onError: (err) => {
      setNewDesignError(
        err instanceof NovaApiError ? err.message : 'Failed to create design.',
      );
    },
  });

  const renameProjectMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      apiClient.updateProject(projectId, { name }),
    onSuccess: async ({ project }) => {
      setRenameTarget(null);
      setRenameProjectError(undefined);
      await queryClient.invalidateQueries({ queryKey: ['projects', project.workspaceId] });
      pushToast({ title: 'Design renamed', description: project.name, tone: 'success' });
    },
    onError: (err) => {
      setRenameProjectError(
        err instanceof NovaApiError ? err.message : 'Failed to rename design.',
      );
    },
  });

  const duplicateProjectMutation = useMutation({
    mutationFn: (projectId: string) => apiClient.duplicateProject(projectId),
    onSuccess: async ({ project }) => {
      await queryClient.invalidateQueries({ queryKey: ['projects', project.workspaceId] });
      pushToast({ title: 'Design duplicated', description: project.name, tone: 'success' });
    },
    onError: (err) => {
      pushToast({
        title: 'Duplicate failed',
        description: err instanceof NovaApiError ? err.message : 'Unable to duplicate design.',
        tone: 'danger',
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: string; workspaceId: string }) =>
      apiClient.deleteProject(projectId),
    onSuccess: async (_data, vars) => {
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['projects', vars.workspaceId] });
      pushToast({ title: 'Design deleted', tone: 'info' });
    },
    onError: (err) => {
      pushToast({
        title: 'Delete failed',
        description: err instanceof NovaApiError ? err.message : 'Unable to delete design.',
        tone: 'danger',
      });
    },
  });

  async function handleLogout() {
    await apiClient.logout();
    queryClient.clear();
    router.replace('/login');
  }

  function handleCreateWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = CreateWorkspaceSchema.safeParse({ name: newWorkspaceName });
    if (!parsed.success) {
      setNewWorkspaceError('Workspace name is required (1–100 characters).');
      return;
    }
    setNewWorkspaceError(undefined);
    createWorkspaceMutation.mutate(parsed.data.name);
  }

  function handleRenameWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeWorkspace) return;
    const parsed = UpdateWorkspaceSchema.safeParse({ name: renameWorkspaceName });
    if (!parsed.success) {
      setRenameWorkspaceError('Workspace name is required (1–100 characters).');
      return;
    }
    setRenameWorkspaceError(undefined);
    renameWorkspaceMutation.mutate({ id: activeWorkspace.id, name: parsed.data.name });
  }

  function handleCreateDesign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeWorkspace) return;
    const parsed = CreateProjectSchema.safeParse({ name: newDesignName });
    if (!parsed.success) {
      setNewDesignError('Design name is required (1–120 characters).');
      return;
    }
    setNewDesignError(undefined);
    createProjectMutation.mutate({ workspaceId: activeWorkspace.id, name: parsed.data.name });
  }

  function handleRenameProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameTarget) return;
    const parsed = UpdateProjectSchema.safeParse({ name: renameProjectName });
    if (!parsed.success) {
      setRenameProjectError('Design name is required (1–120 characters).');
      return;
    }
    setRenameProjectError(undefined);
    renameProjectMutation.mutate({ projectId: renameTarget.id, name: parsed.data.name });
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
  const canCreateProject = activeWorkspace
    ? can(activeWorkspace.role, 'project.create')
    : false;
  const canEditProject = activeWorkspace ? can(activeWorkspace.role, 'project.update') : false;
  const canDeleteProject = activeWorkspace
    ? can(activeWorkspace.role, 'project.delete')
    : false;
  const canUpdateWorkspace = activeWorkspace
    ? can(activeWorkspace.role, 'workspace.update')
    : false;

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
              onClick={() => setNewWorkspaceOpen(true)}
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
                    onClick={() => {
                      setSelectedWorkspaceId(ws.id);
                      setSearchQuery('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-[var(--radius-control)] text-[13px] flex items-center justify-between gap-2 cursor-pointer transition-colors duration-150 ${
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
              <Button onClick={() => setNewWorkspaceOpen(true)}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Create workspace</span>
              </Button>
            </Card>
          ) : (
            <div className="flex flex-col gap-6 max-w-6xl mx-auto">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <h1 className="text-[20px] font-semibold m-0 truncate">
                    {activeWorkspace.name}
                  </h1>
                  <Badge variant={activeWorkspace.role === 'OWNER' ? 'accent' : 'neutral'}>
                    {activeWorkspace.role}
                  </Badge>
                  {canUpdateWorkspace ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Rename workspace"
                      onClick={() => {
                        setRenameWorkspaceName(activeWorkspace.name);
                        setRenameWorkspaceError(undefined);
                        setRenameWorkspaceOpen(true);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <search className="relative flex items-center">
                    <Search
                      aria-hidden="true"
                      className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 pointer-events-none"
                    />
                    <input
                      type="search"
                      aria-label="Search designs"
                      placeholder="Filter designs…"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 pl-9 pr-8 w-56 rounded-[var(--radius-control)] bg-[var(--bg-panel)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/70 hover:border-[var(--border-strong)] focus:border-[var(--accent-2)]"
                    />
                    {searchQuery.length > 0 ? (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </search>

                  {canCreateProject ? (
                    <Button
                      onClick={() => {
                        setNewDesignName('');
                        setNewDesignPreset('1920x1080');
                        setNewDesignError(undefined);
                        setNewDesignOpen(true);
                      }}
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>New design</span>
                    </Button>
                  ) : null}

                  <Button
                    variant="secondary"
                    data-testid="manage-members-btn"
                    onClick={() => setMembersOpen(true)}
                  >
                    <Users className="w-4 h-4" aria-hidden="true" />
                    <span>Members</span>
                  </Button>
                </div>
              </div>

              {projectsQuery.isLoading ? (
                <p className="text-[14px] text-[var(--text-secondary)]">Loading designs…</p>
              ) : projectsQuery.isError ? (
                <Card className="p-6 flex items-center justify-between gap-4">
                  <p className="text-[14px] text-[var(--danger)] m-0">Failed to load designs.</p>
                  <Button variant="secondary" onClick={() => void projectsQuery.refetch()}>
                    Retry
                  </Button>
                </Card>
              ) : (projectsQuery.data?.projects.length ?? 0) === 0 ? (
                <Card className="p-8 flex flex-col items-start gap-4">
                  <FolderKanban
                    className="w-6 h-6 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <h2 className="text-[16px] font-semibold m-0">No designs yet</h2>
                    <p className="text-[13px] text-[var(--text-secondary)] m-0">
                      Create your first design canvas in {activeWorkspace.name}.
                    </p>
                  </div>
                  {canCreateProject ? (
                    <Button
                      onClick={() => {
                        setNewDesignName('');
                        setNewDesignError(undefined);
                        setNewDesignOpen(true);
                      }}
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Create design</span>
                    </Button>
                  ) : null}
                </Card>
              ) : filteredProjects.length === 0 ? (
                <Card className="p-8 flex flex-col items-start gap-3">
                  <h2 className="text-[16px] font-semibold m-0">No matching designs</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] m-0">
                    No designs matched &ldquo;{searchQuery.trim()}&rdquo;.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
                    Clear filter
                  </Button>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProjects.map((project) => (
                    <Card
                      key={project.id}
                      className="overflow-hidden flex flex-col transition-colors duration-150 hover:border-[var(--border-strong)]"
                    >
                      <Link
                        href={`/project/${project.id}`}
                        className="aspect-[16/10] nova-dot-canvas border-b border-[var(--border)] flex items-center justify-center text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] no-underline"
                      >
                        <ProjectThumbnail
                          projectId={project.id}
                          thumbnailUrl={project.thumbnailUrl}
                          name={project.name}
                        />
                      </Link>
                      <div className="p-4 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/project/${project.id}`}
                            className="block text-[14px] font-medium text-[var(--text-primary)] hover:text-[var(--accent-2)] truncate no-underline"
                          >
                            {project.name}
                          </Link>
                          <p className="text-[12px] text-[var(--text-secondary)] m-0 mt-0.5 font-[family-name:var(--font-mono)]">
                            {formatRelativeDate(project.updatedAt)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {canEditProject ? (
                            <button
                              type="button"
                              aria-label={`Rename ${project.name}`}
                              title="Rename"
                              onClick={() => {
                                setRenameTarget(project);
                                setRenameProjectName(project.name);
                                setRenameProjectError(undefined);
                              }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : null}

                          {canCreateProject ? (
                            <button
                              type="button"
                              aria-label={`Duplicate ${project.name}`}
                              title="Duplicate"
                              disabled={duplicateProjectMutation.isPending}
                              onClick={() => duplicateProjectMutation.mutate(project.id)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer disabled:opacity-50"
                            >
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : null}

                          {canDeleteProject ? (
                            <button
                              type="button"
                              aria-label={`Delete ${project.name}`}
                              title="Delete"
                              onClick={() => setDeleteTarget(project)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Create workspace dialog */}
      <Dialog
        open={newWorkspaceOpen}
        onClose={() => {
          setNewWorkspaceOpen(false);
          setNewWorkspaceError(undefined);
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
            value={newWorkspaceName}
            error={newWorkspaceError}
            onChange={(e) => {
              setNewWorkspaceName(e.target.value);
              if (newWorkspaceError) setNewWorkspaceError(undefined);
            }}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewWorkspaceOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createWorkspaceMutation.isPending}>
              {createWorkspaceMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Rename workspace dialog */}
      <Dialog
        open={renameWorkspaceOpen}
        onClose={() => {
          setRenameWorkspaceOpen(false);
          setRenameWorkspaceError(undefined);
        }}
        title="Rename workspace"
      >
        <form onSubmit={handleRenameWorkspace} className="flex flex-col gap-4">
          <Input
            id="rename-workspace-name"
            name="workspaceName"
            label="Workspace name"
            value={renameWorkspaceName}
            error={renameWorkspaceError}
            onChange={(e) => {
              setRenameWorkspaceName(e.target.value);
              if (renameWorkspaceError) setRenameWorkspaceError(undefined);
            }}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameWorkspaceOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={renameWorkspaceMutation.isPending}>
              {renameWorkspaceMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Create design dialog */}
      <Dialog
        open={newDesignOpen}
        onClose={() => {
          setNewDesignOpen(false);
          setNewDesignError(undefined);
        }}
        title="New design"
        description="Start a collaborative canvas in the active workspace."
      >
        <form onSubmit={handleCreateDesign} className="flex flex-col gap-4">
          <Input
            id="new-design-name"
            name="designName"
            label="Design name"
            placeholder="Hero Banner v1"
            value={newDesignName}
            error={newDesignError}
            onChange={(e) => {
              setNewDesignName(e.target.value);
              if (newDesignError) setNewDesignError(undefined);
            }}
            required
          />
          <Select
            id="new-design-preset"
            label="Canvas preset"
            value={newDesignPreset}
            onChange={(e) => setNewDesignPreset(e.target.value as DesignPreset)}
          >
            <option value="1920x1080">Desktop 1920 × 1080</option>
            <option value="1080x1080">Square 1080 × 1080</option>
            <option value="1080x1920">Story 1080 × 1920</option>
            <option value="custom">Infinite Canvas</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewDesignOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createProjectMutation.isPending}>
              {createProjectMutation.isPending ? 'Creating…' : 'Create design'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Rename design dialog */}
      <Dialog
        open={renameTarget !== null}
        onClose={() => {
          setRenameTarget(null);
          setRenameProjectError(undefined);
        }}
        title="Rename design"
      >
        <form onSubmit={handleRenameProject} className="flex flex-col gap-4">
          <Input
            id="rename-design-name"
            name="designName"
            label="Design name"
            value={renameProjectName}
            error={renameProjectError}
            onChange={(e) => {
              setRenameProjectName(e.target.value);
              if (renameProjectError) setRenameProjectError(undefined);
            }}
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={renameProjectMutation.isPending}>
              {renameProjectMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete design confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete design"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This removes it from the workspace.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteProjectMutation.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              deleteProjectMutation.mutate({
                projectId: deleteTarget.id,
                workspaceId: deleteTarget.workspaceId,
              });
            }}
          >
            {deleteProjectMutation.isPending ? 'Deleting…' : 'Delete design'}
          </Button>
        </div>
      </Dialog>

      {activeWorkspace ? (
        <WorkspaceMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          workspace={activeWorkspace}
          currentUserId={user?.id}
        />
      ) : null}
    </div>
  );
}
