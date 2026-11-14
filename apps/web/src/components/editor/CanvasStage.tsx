'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Maximize2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import type { Editor, EditorKeyEvent } from '@nova/editor-core';
import type { AssetUrlResolver, KonvaRenderer } from '@nova/editor-konva';
import type { AssetDto, Point } from '@nova/shared';

export interface CanvasStageProps {
  editor: Editor;
  zoom: number;
  readOnly: boolean;
  onRendererReady: (renderer: KonvaRenderer | null) => void;
  resolveAssetUrl?: AssetUrlResolver;
  onDropImageFile?: (file: File, worldPoint: Point) => void;
  onDropProjectAsset?: (asset: AssetDto, worldPoint: Point) => void;
}

interface TextEditSession {
  nodeId: string;
  value: string;
  rect: { x: number; y: number; width: number; height: number };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function CanvasStage({
  editor,
  zoom,
  readOnly,
  onRendererReady,
  resolveAssetUrl,
  onDropImageFile,
  onDropProjectAsset,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onRendererReadyRef = useRef(onRendererReady);
  onRendererReadyRef.current = onRendererReady;
  const resolveAssetUrlRef = useRef(resolveAssetUrl);
  resolveAssetUrlRef.current = resolveAssetUrl;

  const [textEdit, setTextEdit] = useState<TextEditSession | null>(null);
  const [isDragOverFile, setIsDragOverFile] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let instance: KonvaRenderer | null = null;

    void import('@nova/editor-konva').then(({ KonvaRenderer }) => {
      if (cancelled || !containerRef.current) return;
      instance = new KonvaRenderer(editor, {
        resolveAssetUrl: (assetId) => resolveAssetUrlRef.current?.(assetId) ?? null,
        onTextEditRequested: (node, screenRect) => {
          if (editor.commands.isReadOnly()) return;
          setTextEdit({
            nodeId: node.id,
            value: node.text ?? '',
            rect: screenRect,
          });
        },
      });
      instance.mount(containerRef.current);
      onRendererReadyRef.current(instance);
    });

    return () => {
      cancelled = true;
      onRendererReadyRef.current(null);
      instance?.destroy();
    };
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      const ev: EditorKeyEvent = {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      };
      const res = editor.tools.handleKeyDown(ev);
      if (res.handled) {
        e.preventDefault();
      }
      if (res.copiedText && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(res.copiedText).catch(() => {});
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const ev: EditorKeyEvent = {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
      };
      editor.tools.handleKeyUp(ev);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editor]);

  const commitInlineText = () => {
    if (!textEdit) return;
    if (!readOnly) {
      editor.commands.execute({
        type: 'setText',
        nodeId: textEdit.nodeId,
        text: textEdit.value,
      });
    }
    setTextEdit(null);
  };

  const stepZoom = (factor: number) => {
    const el = containerRef.current;
    const width = el?.clientWidth || 800;
    const height = el?.clientHeight || 600;
    const current = editor.viewport.getState();
    editor.viewport.zoomAt(current.zoom * factor, { x: width / 2, y: height / 2 });
  };

  const fitCanvas = () => {
    const el = containerRef.current;
    editor.viewport.fitToNodes(editor.scene.getAllNodes(), {
      width: el?.clientWidth || 1200,
      height: el?.clientHeight || 800,
    });
  };

  const toWorldPointFromDrop = (e: DragEvent<HTMLDivElement>): Point => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const hasCoords = e.clientX !== 0 || e.clientY !== 0;
    const screenPt = rect
      ? hasCoords
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: rect.width / 2, y: rect.height / 2 }
      : { x: 240, y: 180 };
    return editor.viewport.screenToWorld(screenPt);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const types = Array.from(e.dataTransfer?.types ?? []);
    if (!types.includes('Files') && !types.includes('application/x-nova-asset')) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverFile) {
      setIsDragOverFile(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOverFile(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    const hasFiles = types.includes('Files') || (e.dataTransfer?.files?.length ?? 0) > 0;
    if (!hasFiles && !types.includes('application/x-nova-asset')) {
      return;
    }
    e.preventDefault();
    setIsDragOverFile(false);
    if (readOnly) return;

    const worldPoint = toWorldPointFromDrop(e);
    const assetJson = e.dataTransfer.getData('application/x-nova-asset');
    if (assetJson) {
      try {
        const asset = JSON.parse(assetJson) as AssetDto;
        onDropProjectAsset?.(asset, worldPoint);
        return;
      } catch {
        // ignore invalid drag data
      }
    }

    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) {
      onDropImageFile?.(file, worldPoint);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex-1 min-w-0 min-h-0 bg-[var(--bg-canvas)] overflow-hidden select-none"
    >
      <div
        ref={containerRef}
        data-testid="canvas-stage"
        aria-label="Design canvas"
        className="absolute inset-0 w-full h-full touch-none"
      />
      {isDragOverFile ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 z-30 rounded-[var(--radius-panel)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10 flex items-center justify-center"
        >
          <div className="flex items-center gap-2 rounded-[var(--radius-panel)] bg-[var(--bg-panel)]/95 border border-[var(--border-strong)] px-4 py-2 text-[13px] font-medium text-[var(--text-primary)] shadow-lg">
            <Upload className="w-4 h-4 text-[var(--accent)]" />
            Drop image to place on canvas
          </div>
        </div>
      ) : null}

      {/* Inline double-click text editing overlay */}
      {textEdit ? (
        <textarea
          aria-label="Inline text editor"
          autoFocus
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onBlur={commitInlineText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitInlineText();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setTextEdit(null);
            }
          }}
          style={{
            left: `${Math.max(8, textEdit.rect.x)}px`,
            top: `${Math.max(8, textEdit.rect.y)}px`,
            width: `${Math.max(120, textEdit.rect.width)}px`,
            minHeight: `${Math.max(36, textEdit.rect.height)}px`,
          }}
          className="absolute z-20 p-1.5 rounded-[var(--radius-control)] bg-[var(--bg-panel)] border-2 border-[var(--accent)] text-[var(--text-primary)] text-[14px] leading-snug shadow-lg resize-none"
        />
      ) : null}

      {/* Floating bottom-right Zoom HUD */}
      <div
        role="group"
        aria-label="Viewport zoom controls"
        className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--bg-panel)]/95 p-1 shadow-lg"
      >
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => stepZoom(0.8)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100% (Ctrl+0)"
          onClick={() => editor.viewport.zoomTo100()}
          className="h-7 px-2 rounded-[var(--radius-control)] text-[11px] font-mono tabular-nums text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => stepZoom(1.25)}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Fit canvas to screen"
          title="Fit all layers (Shift+1)"
          onClick={fitCanvas}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
