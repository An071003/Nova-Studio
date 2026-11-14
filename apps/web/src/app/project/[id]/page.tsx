'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Y from 'yjs';
import { can, DEFAULT_PAGE_ID, type CanvasNode, type ToolId, type ViewportState } from '@nova/shared';
import { Editor, type HistoryState } from '@nova/editor-core';
import type { KonvaRenderer } from '@nova/editor-konva';
import { Button, useToast } from '@nova/ui';
import { NovaApiError, apiClient } from '../../../lib/api';
import { TopBar } from '../../../components/editor/TopBar';
import { LayersPanel } from '../../../components/editor/LayersPanel';
import { PropertiesPanel } from '../../../components/editor/PropertiesPanel';
import { CanvasStage } from '../../../components/editor/CanvasStage';
import { StatusBar } from '../../../components/editor/StatusBar';

export interface NovaEditorDebugHandle {
  editor: Editor;
  renderer: KonvaRenderer | null;
  doc: Y.Doc;
}

declare global {
  interface Window {
    __NOVA_EDITOR__?: NovaEditorDebugHandle;
  }
}

export default function ProjectEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.getMe(),
  });

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.getProject(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    const err = meQuery.error ?? projectQuery.error;
    if (err instanceof NovaApiError && err.status === 401) {
      router.replace('/login');
    }
  }, [meQuery.error, projectQuery.error, router]);

  const user = meQuery.data?.user;
  const project = projectQuery.data?.project;
  const role = projectQuery.data?.role ?? 'VIEWER';
  const readOnly = !can(role, 'canvas.edit');
  const canRenameProject = can(role, 'project.update');

  const doc = useMemo(() => new Y.Doc(), [projectId]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const rendererRef = useRef<KonvaRenderer | null>(null);
  const stageWrapperRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [historyState, setHistoryState] = useState<HistoryState>({ canUndo: false, canRedo: false });
  const [viewport, setViewport] = useState<ViewportState>({ x: 0, y: 0, zoom: 1 });
  const [exporting, setExporting] = useState(false);

  const userId = user?.id;
  const userName = user?.name;
  const loadedProjectId = project?.id;
  const initialReadOnlyRef = useRef(readOnly);
  initialReadOnlyRef.current = readOnly;

  // Initialize headless Editor instance once authenticated user & project load
  useEffect(() => {
    if (!userId || !loadedProjectId) return;
    const instance = new Editor({
      doc,
      userId,
      userName,
      readOnly: initialReadOnlyRef.current,
      pageId: DEFAULT_PAGE_ID,
      getViewportSize: () => ({
        width: stageWrapperRef.current?.clientWidth || 1200,
        height: stageWrapperRef.current?.clientHeight || 800,
      }),
    });

    setNodes([...instance.scene.getAllNodes(DEFAULT_PAGE_ID)]);
    setSelectedIds(instance.selection.getIds());
    setActiveTool(instance.tools.getActiveTool());
    setHistoryState(instance.history.getState());
    setViewport(instance.viewport.getState());
    setEditor(instance);

    window.__NOVA_EDITOR__ = {
      editor: instance,
      renderer: rendererRef.current,
      doc,
    };

    const unsubs = [
      instance.subscribe('sceneDiff', () => {
        setNodes([...instance.scene.getAllNodes(DEFAULT_PAGE_ID)]);
      }),
      instance.subscribe('selection', (snap) => {
        setSelectedIds([...snap.ids]);
      }),
      instance.subscribe('history', (state) => {
        setHistoryState(state);
      }),
      instance.subscribe('viewport', (vp) => {
        setViewport(vp);
      }),
      instance.tools.subscribeToolChange((tool) => {
        setActiveTool(tool);
      }),
    ];

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
      if (window.__NOVA_EDITOR__?.editor === instance) {
        delete window.__NOVA_EDITOR__;
      }
      instance.destroy();
      setEditor(null);
    };
  }, [doc, userId, userName, loadedProjectId]);

  // Keep readOnly synchronized if effective role updates without remounting
  useEffect(() => {
    if (editor) {
      editor.setReadOnly(readOnly);
    }
  }, [editor, readOnly]);

  const handleRendererReady = useCallback(
    (renderer: KonvaRenderer | null) => {
      rendererRef.current = renderer;
      if (window.__NOVA_EDITOR__ && editor) {
        window.__NOVA_EDITOR__ = { editor, renderer, doc };
      }
    },
    [doc, editor],
  );

  const renameProjectMutation = useMutation({
    mutationFn: (nextName: string) => apiClient.updateProject(projectId, { name: nextName }),
    onSuccess: (res) => {
      queryClient.setQueryData(['project', projectId], res);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      pushToast({ title: 'Project renamed', tone: 'success' });
    },
    onError: (err) => {
      pushToast({
        title: err instanceof Error ? err.message : 'Could not rename project',
        tone: 'danger',
      });
    },
  });

  const handleExportPng = async () => {
    const renderer = rendererRef.current;
    if (!renderer) {
      pushToast({ title: 'Canvas renderer is not ready yet', tone: 'danger' });
      return;
    }
    setExporting(true);
    try {
      const targetIds = selectedIds.length > 0 ? selectedIds : undefined;
      const dataUrl = await renderer.exportDataURL({
        scale: 1,
        nodeIds: targetIds,
      });
      const safeName = (project?.name ?? 'nova-design')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-|-$/g, '') || 'nova-design';
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = `${safeName}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pushToast({ title: 'Exported PNG', tone: 'success' });
    } catch (err) {
      pushToast({
        title: err instanceof Error ? err.message : 'Export failed',
        tone: 'danger',
      });
    } finally {
      setExporting(false);
    }
  };

  const selectedNodes = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return selectedIds.map((id) => byId.get(id)).filter((n): n is CanvasNode => Boolean(n));
  }, [nodes, selectedIds]);

  const handleReorderNode = (nodeId: string, direction: 'forward' | 'backward') => {
    if (!editor || readOnly) return;
    const node = editor.scene.getNode(nodeId);
    if (!node) return;
    const siblings = editor.scene.getChildren(node.parentId, node.pageId);
    const idx = siblings.findIndex((s) => s.id === nodeId);
    if (idx < 0) return;
    if (direction === 'forward' && idx < siblings.length - 1) {
      const target = siblings[idx + 1]!;
      const afterTarget = siblings[idx + 2] ?? null;
      editor.commands.execute({
        type: 'reorder',
        nodeId,
        afterIndex: target.index,
        beforeIndex: afterTarget?.index ?? null,
      });
    } else if (direction === 'backward' && idx > 0) {
      const target = siblings[idx - 1]!;
      const beforeTarget = siblings[idx - 2] ?? null;
      editor.commands.execute({
        type: 'reorder',
        nodeId,
        afterIndex: beforeTarget?.index ?? null,
        beforeIndex: target.index,
      });
    }
  };

  if (meQuery.isPending || projectQuery.isPending) {
    return (
      <main className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center text-[var(--text-secondary)]">
        <p className="text-[14px]">Loading canvas studio…</p>
      </main>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <main className="h-screen w-screen bg-[var(--bg-app)] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">
            Unable to open design
          </h1>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            {projectQuery.error instanceof Error
              ? projectQuery.error.message
              : 'You may not have access to this project.'}
          </p>
          <div className="mt-4 flex justify-center">
            <Link href="/dashboard">
              <Button variant="primary">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
      <TopBar
        projectName={project.name}
        role={role}
        readOnly={readOnly}
        canRenameProject={canRenameProject}
        activeTool={activeTool}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        hasSelection={selectedIds.length > 0}
        exporting={exporting}
        onSelectTool={(tool) => editor?.tools.setTool(tool)}
        onUndo={() => editor?.history.undo()}
        onRedo={() => editor?.history.redo()}
        onDeleteSelection={() => {
          if (!editor || readOnly || selectedIds.length === 0) return;
          editor.commands.execute({ type: 'deleteNodes', ids: selectedIds });
          editor.selection.clear();
        }}
        onRenameProject={async (nextName) => {
          await renameProjectMutation.mutateAsync(nextName);
        }}
        onExportPng={handleExportPng}
      />

      <div className="flex-1 min-h-0 flex">
        <LayersPanel
          nodes={nodes}
          selectedIds={selectedIds}
          readOnly={readOnly}
          onSelectNode={(id, additive) => {
            if (!editor) return;
            if (additive) {
              editor.selection.toggle(id);
            } else {
              editor.selection.set([id]);
            }
          }}
          onRenameNode={(id, name) => {
            editor?.commands.execute({ type: 'updateNodes', patches: [{ id, patch: { name } }] });
          }}
          onToggleVisible={(node) => {
            editor?.commands.execute({
              type: 'updateNodes',
              patches: [{ id: node.id, patch: { visible: !node.visible } }],
            });
          }}
          onToggleLocked={(node) => {
            editor?.commands.execute({
              type: 'updateNodes',
              patches: [{ id: node.id, patch: { locked: !node.locked } }],
            });
          }}
          onReorderNode={handleReorderNode}
        />

        <main ref={stageWrapperRef} className="flex-1 min-w-0 min-h-0 flex">
          {editor ? (
            <CanvasStage
              editor={editor}
              zoom={viewport.zoom}
              readOnly={readOnly}
              onRendererReady={handleRendererReady}
            />
          ) : (
            <div className="flex-1 bg-[var(--bg-canvas)] flex items-center justify-center text-[13px] text-[var(--text-secondary)]">
              Initializing canvas…
            </div>
          )}
        </main>

        <PropertiesPanel
          selectedNodes={selectedNodes}
          allNodes={nodes}
          viewport={viewport}
          readOnly={readOnly}
          onUpdateNodes={(patches) => editor?.commands.execute({ type: 'updateNodes', patches })}
          onSetText={(nodeId, text) => editor?.commands.execute({ type: 'setText', nodeId, text })}
          onAlign={(mode) => {
            if (!editor || selectedIds.length < 2) return;
            editor.commands.execute({ type: 'alignNodes', ids: selectedIds, mode });
          }}
          onDistribute={(axis) => {
            if (!editor || selectedIds.length < 3) return;
            editor.commands.execute({ type: 'distributeNodes', ids: selectedIds, axis });
          }}
          onGroup={() => {
            if (!editor || selectedIds.length < 2) return;
            const res = editor.commands.execute({ type: 'group', ids: selectedIds });
            if (res.createdIds[0]) {
              editor.selection.set([res.createdIds[0]]);
            }
          }}
          onUngroup={(groupId) => {
            if (!editor) return;
            const res = editor.commands.execute({ type: 'ungroup', id: groupId });
            editor.selection.set(res.updatedIds);
          }}
        />
      </div>

      <StatusBar
        connectionState="local"
        activeTool={activeTool}
        readOnly={readOnly}
        zoom={viewport.zoom}
        nodeCount={nodes.length}
        selectedCount={selectedNodes.length}
      />
    </div>
  );
}
