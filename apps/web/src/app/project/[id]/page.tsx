'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import {
  ALLOWED_ASSET_MIME_TYPES,
  can,
  colorForUserId,
  DEFAULT_PAGE_ID,
  MAX_ASSET_SIZE_BYTES,
  type AllowedAssetMimeType,
  type AssetDto,
  type CanvasNode,
  type Point,
  type ToolId,
  type ViewportState,
} from '@nova/shared';
import {
  Editor,
  type HistoryState,
  type RemotePresence,
  type SceneDiff,
} from '@nova/editor-core';
import type { KonvaRenderer } from '@nova/editor-konva';
import { Button, useToast } from '@nova/ui';
import { NovaApiError, apiClient } from '../../../lib/api';
import {
  createRealtimeSession,
  type RealtimeConnectionState,
  type RealtimeSession,
} from '../../../lib/realtime-client';
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

export interface NovaE2EHook {
  scene: () => CanvasNode[];
  presences: () => RemotePresence[];
  on: (event: 'remoteUpdate', cb: (diff: SceneDiff) => void) => () => void;
}

declare global {
  interface Window {
    __NOVA_EDITOR__?: NovaEditorDebugHandle;
    __nova?: NovaE2EHook;
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
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

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
  const [remotePresences, setRemotePresences] = useState<RemotePresence[]>([]);
  const [connectionState, setConnectionState] = useState<
    'local' | RealtimeConnectionState
  >('connecting');
  const [exporting, setExporting] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const assetUrlCacheRef = useRef(new Map<string, { url: string; expiresAt: number }>());
  const inFlightAssetUrlsRef = useRef(new Map<string, Promise<string | null>>());

  const userId = user?.id;
  const userName = user?.name;
  const avatarUrl = user?.avatarUrl ?? undefined;
  const loadedProjectId = project?.id;

  const assetsQuery = useQuery({
    queryKey: ['project-assets', projectId],
    queryFn: () => apiClient.listProjectAssets(projectId),
    enabled: Boolean(loadedProjectId),
  });

  const resolveAssetUrl = useCallback(async (assetId: string): Promise<string | null> => {
    const cached = assetUrlCacheRef.current.get(assetId);
    if (cached && cached.expiresAt > Date.now() + 15_000) {
      return cached.url;
    }
    const existingPromise = inFlightAssetUrlsRef.current.get(assetId);
    if (existingPromise) {
      return existingPromise;
    }
    const pending = apiClient
      .getAssetUrl(assetId)
      .then((res) => {
        assetUrlCacheRef.current.set(assetId, {
          url: res.url,
          expiresAt: Date.now() + Math.max(30, res.expiresIn - 15) * 1000,
        });
        return res.url;
      })
      .catch(() => null)
      .finally(() => {
        inFlightAssetUrlsRef.current.delete(assetId);
      });
    inFlightAssetUrlsRef.current.set(assetId, pending);
    return pending;
  }, []);
  const initialReadOnlyRef = useRef(readOnly);
  initialReadOnlyRef.current = readOnly;

  // Initialize Realtime session + IndexedDB + Editor once authenticated user & project load
  useEffect(() => {
    if (!userId || !loadedProjectId) return;

    let cancelled = false;
    let instance: Editor | null = null;
    let session: RealtimeSession | null = null;
    let fallbackIdb: IndexeddbPersistence | null = null;
    const unsubs: Array<() => void> = [];

    const setup = async () => {
      try {
        session = await createRealtimeSession({
          projectId: loadedProjectId,
          doc,
          onStatusChange: (next) => {
            if (!cancelled) {
              setConnectionState(next);
            }
          },
          onScopeChange: (scope) => {
            if (!cancelled && scope === 'readonly') {
              instance?.setReadOnly(true);
            }
          },
          onStatelessMessage: (payload) => {
            if (cancelled) return;
            try {
              const parsed = JSON.parse(payload) as { type?: string };
              if (parsed.type === 'version.restored') {
                pushToastRef.current({
                  title: 'Project restored to another version',
                  tone: 'info',
                });
              }
            } catch {
              // ignore non-JSON stateless messages
            }
          },
        });
      } catch {
        if (typeof indexedDB !== 'undefined') {
          fallbackIdb = new IndexeddbPersistence(`nova:project:${loadedProjectId}`, doc);
        }
        if (!cancelled) {
          setConnectionState(
            typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'local',
          );
        }
      }

      if (cancelled) {
        await session?.destroy();
        await fallbackIdb?.destroy().catch(() => {});
        return;
      }

      const userColor = colorForUserId(userId);
      instance = new Editor({
        doc,
        userId,
        userName,
        userColor,
        avatarUrl,
        awareness: session?.awareness,
        readOnly: initialReadOnlyRef.current,
        pageId: DEFAULT_PAGE_ID,
        getViewportSize: () => ({
          width: stageWrapperRef.current?.clientWidth || 1200,
          height: stageWrapperRef.current?.clientHeight || 800,
        }),
      });

      setNodes([...instance.scene.getAllNodes(DEFAULT_PAGE_ID)]);
      setSelectedIds([...instance.selection.getIds()]);
      setActiveTool(instance.tools.getActiveTool());
      setHistoryState(instance.history.getState());
      setViewport(instance.viewport.getState());
      setRemotePresences(instance.presence.getRemotePresences());
      setEditor(instance);

      window.__NOVA_EDITOR__ = {
        editor: instance,
        renderer: rendererRef.current,
        doc,
      };
      window.__nova = {
        scene: () => instance?.scene.getAllNodes(DEFAULT_PAGE_ID) ?? [],
        presences: () => instance?.presence.getRemotePresences() ?? [],
        on: (event, cb) => {
          if (event === 'remoteUpdate' && instance) {
            return instance.subscribe('sceneDiff', ({ diff, isRemote }) => {
              if (isRemote) {
                cb(diff);
              }
            });
          }
          return () => {};
        },
      };

      unsubs.push(
        instance.subscribe('sceneDiff', () => {
          if (!instance) return;
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
        instance.subscribe('presence', (remotes) => {
          setRemotePresences([...remotes]);
        }),
        instance.subscribe('remoteNodeDeleted', ({ ids }) => {
          pushToastRef.current({
            title:
              ids.length > 1
                ? `${ids.length} selected layers were deleted by a collaborator`
                : 'Selected layer was deleted by a collaborator',
            tone: 'warning',
          });
        }),
        instance.tools.subscribeToolChange((tool) => {
          setActiveTool(tool);
        }),
      );

      session?.connect();
    };

    void setup();

    return () => {
      cancelled = true;
      for (const unsub of unsubs) {
        unsub();
      }
      if (window.__NOVA_EDITOR__?.editor === instance) {
        delete window.__NOVA_EDITOR__;
      }
      delete window.__nova;
      instance?.destroy();
      setEditor(null);
      setRemotePresences([]);
      void session?.destroy();
      void fallbackIdb?.destroy().catch(() => {});
    };
  }, [doc, userId, userName, avatarUrl, loadedProjectId]);

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

  const handleDragReorderNode = (
    draggedId: string,
    targetId: string,
    position: 'above' | 'below',
  ) => {
    if (!editor || readOnly || draggedId === targetId) return;
    const dragged = editor.scene.getNode(draggedId);
    const target = editor.scene.getNode(targetId);
    if (!dragged || !target || target.id === draggedId) return;

    const siblings = editor.scene
      .getChildren(target.parentId, target.pageId)
      .filter((s) => s.id !== draggedId);
    const targetIdx = siblings.findIndex((s) => s.id === targetId);
    if (targetIdx < 0) return;

    const afterIndex = position === 'above' ? target.index : siblings[targetIdx - 1]?.index ?? null;
    const beforeIndex =
      position === 'above' ? siblings[targetIdx + 1]?.index ?? null : target.index;

    editor.commands.execute({
      type: 'reorder',
      nodeId: draggedId,
      parentId: target.parentId,
      afterIndex,
      beforeIndex,
    });
  };

  const insertAssetOnCanvas = useCallback(
    (asset: AssetDto, worldPoint?: Point, label?: string) => {
      if (!editor || readOnly) return;
      const rawW = asset.width ?? 240;
      const rawH = asset.height ?? 180;
      const scale = Math.min(1, 360 / Math.max(1, rawW, rawH));
      const width = Math.max(24, Math.round(rawW * scale));
      const height = Math.max(24, Math.round(rawH * scale));

      const targetCenter =
        worldPoint ??
        editor.viewport.screenToWorld({
          x: (stageWrapperRef.current?.clientWidth || 1200) / 2,
          y: (stageWrapperRef.current?.clientHeight || 800) / 2,
        });

      const res = editor.commands.execute({
        type: 'createNode',
        input: {
          type: 'image',
          assetId: asset.id,
          name: label ? label.replace(/\.[^.]+$/, '') : 'Image',
          x: Math.round(targetCenter.x - width / 2),
          y: Math.round(targetCenter.y - height / 2),
          width,
          height,
          fill: null,
        },
      });
      if (res.createdIds[0]) {
        editor.selection.set([res.createdIds[0]]);
        editor.tools.setTool('select');
      }
    },
    [editor, readOnly],
  );

  const uploadAndInsertAsset = useCallback(
    async (file: File, worldPoint?: Point) => {
      if (!editor || readOnly) {
        pushToast({ title: 'Viewers cannot upload assets', tone: 'warning' });
        return;
      }

      const inferredMime =
        file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png');
      if (!ALLOWED_ASSET_MIME_TYPES.includes(inferredMime as AllowedAssetMimeType)) {
        pushToast({
          title: `Unsupported image type "${inferredMime}". Use PNG, JPEG, WebP, GIF, or SVG.`,
          tone: 'danger',
        });
        return;
      }

      if (file.size > MAX_ASSET_SIZE_BYTES) {
        const sizeMb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
        pushToast({
          title: `File (${sizeMb} MB) exceeds the 25 MB maximum upload limit`,
          tone: 'danger',
        });
        return;
      }

      setUploadingAsset(true);
      try {
        const presign = await apiClient.createAssetUploadUrl(projectId, {
          mimeType: inferredMime,
          sizeBytes: file.size,
          filename: file.name || 'image.png',
        });

        const putRes = await fetch(presign.putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': inferredMime },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Object storage upload failed (${putRes.status})`);
        }

        const { asset } = await apiClient.confirmAsset(presign.assetId);
        queryClient.setQueryData<{ assets: AssetDto[] }>(
          ['project-assets', projectId],
          (prev) => ({
            assets: [asset, ...(prev?.assets ?? []).filter((a) => a.id !== asset.id)],
          }),
        );
        insertAssetOnCanvas(asset, worldPoint, file.name);
        pushToast({ title: `Uploaded ${file.name}`, tone: 'success' });
      } catch (err) {
        pushToast({
          title: err instanceof Error ? err.message : 'Asset upload failed',
          tone: 'danger',
        });
      } finally {
        setUploadingAsset(false);
      }
    },
    [editor, insertAssetOnCanvas, projectId, pushToast, queryClient, readOnly],
  );

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
        currentUser={
          user
            ? { id: user.id, name: user.name, color: colorForUserId(user.id) }
            : null
        }
        remotePresences={remotePresences}
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
          assets={assetsQuery.data?.assets ?? []}
          uploadingAsset={uploadingAsset}
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
          onDragReorderNode={handleDragReorderNode}
          onUploadAssetFile={(file) => void uploadAndInsertAsset(file)}
          onInsertAsset={(asset) => insertAssetOnCanvas(asset)}
        />

        <main ref={stageWrapperRef} className="flex-1 min-w-0 min-h-0 flex">
          {editor ? (
            <CanvasStage
              editor={editor}
              zoom={viewport.zoom}
              readOnly={readOnly}
              onRendererReady={handleRendererReady}
              resolveAssetUrl={resolveAssetUrl}
              onDropImageFile={(file, worldPoint) => void uploadAndInsertAsset(file, worldPoint)}
              onDropProjectAsset={(asset, worldPoint) => insertAssetOnCanvas(asset, worldPoint)}
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
        connectionState={connectionState}
        activeTool={activeTool}
        readOnly={readOnly}
        zoom={viewport.zoom}
        nodeCount={nodes.length}
        selectedCount={selectedNodes.length}
      />
    </div>
  );
}
