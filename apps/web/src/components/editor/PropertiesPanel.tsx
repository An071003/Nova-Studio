'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Group, Ungroup } from 'lucide-react';
import type { AlignMode, NodePatch } from '@nova/editor-core';
import type { CanvasNode, ViewportState } from '@nova/shared';
import { Button } from '@nova/ui';
import { normalizeHexColor, toColorInputValue } from './color-utils';

export interface PropertiesPanelProps {
  selectedNodes: CanvasNode[];
  allNodes: CanvasNode[];
  viewport: ViewportState;
  readOnly: boolean;
  onUpdateNodes: (patches: Array<{ id: string; patch: NodePatch }>) => void;
  onSetText: (nodeId: string, text: string) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onGroup: () => void;
  onUngroup: (groupId: string) => void;
}

function NumericField({
  label,
  value,
  disabled,
  min,
  max,
  step = 1,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onCommit: (next: number) => void;
}) {
  const inputId = useId();
  const formatted = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(formatted);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatted);
    }
  }, [formatted, focused]);

  const commitValue = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatted);
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (next !== value) {
      onCommit(next);
    }
    setDraft(String(next));
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="number"
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false);
            commitValue();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitValue();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setDraft(formatted);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-full h-8 px-2 pr-6 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[12px] font-mono tabular-nums text-[var(--text-primary)] disabled:opacity-50"
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="absolute right-2 text-[10px] text-[var(--text-secondary)] pointer-events-none"
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AlignButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
}

export function PropertiesPanel({
  selectedNodes,
  allNodes,
  viewport,
  readOnly,
  onUpdateNodes,
  onSetText,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
}: PropertiesPanelProps) {
  const fillInputId = useId();
  const fillHexId = useId();
  const strokeInputId = useId();
  const strokeHexId = useId();
  const textAreaId = useId();

  const primary = selectedNodes[0] ?? null;
  const ids = selectedNodes.map((n) => n.id);
  const canAlign = !readOnly && selectedNodes.length >= 2;
  const canDistribute = !readOnly && selectedNodes.length >= 3;

  const [fillText, setFillText] = useState(primary?.fill ?? '');
  const [strokeText, setStrokeText] = useState(primary?.stroke ?? '');

  useEffect(() => {
    setFillText(primary?.fill ?? '');
    setStrokeText(primary?.stroke ?? '');
  }, [primary?.id, primary?.fill, primary?.stroke]);

  const patchSelection = (patch: NodePatch) => {
    if (readOnly || ids.length === 0) return;
    onUpdateNodes(ids.map((id) => ({ id, patch })));
  };

  return (
    <aside
      aria-label="Properties inspector"
      className="w-[280px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-panel)] overflow-y-auto p-3 flex flex-col gap-4"
    >
      {!primary ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Canvas
          </h2>
          <div className="rounded-[var(--radius-panel)] bg-[var(--bg-elevated)] border border-[var(--border)] p-3 flex flex-col gap-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Total layers</span>
              <span className="font-mono text-[var(--text-primary)]">{allNodes.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Zoom</span>
              <span className="font-mono text-[var(--text-primary)]">
                {Math.round(viewport.zoom * 100)}%
              </span>
            </div>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-[var(--border)] p-3 text-[12px] text-[var(--text-secondary)] flex flex-col gap-1.5">
            <p className="font-medium text-[var(--text-primary)]">Shortcuts</p>
            <p>
              <kbd className="font-mono text-[var(--text-primary)]">V / F / R / O / L / T / H</kbd>{' '}
              switch tools
            </p>
            <p>
              <kbd className="font-mono text-[var(--text-primary)]">Space</kbd> + drag to pan
            </p>
            <p>
              <kbd className="font-mono text-[var(--text-primary)]">Ctrl/Cmd + D</kbd> duplicate
            </p>
            <p>
              <kbd className="font-mono text-[var(--text-primary)]">Ctrl/Cmd + G</kbd> group
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                {selectedNodes.length > 1
                  ? `${selectedNodes.length} layers selected`
                  : primary.name}
              </h2>
              <p className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
                {selectedNodes.length > 1 ? 'Multi-selection' : primary.type}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {selectedNodes.length >= 2 && !readOnly ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onGroup}
                  aria-label="Group selection"
                  title="Group (Ctrl+G)"
                  className="px-2"
                >
                  <Group className="w-3.5 h-3.5" />
                </Button>
              ) : null}
              {selectedNodes.length === 1 && primary.type === 'group' && !readOnly ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUngroup(primary.id)}
                  aria-label="Ungroup"
                  title="Ungroup (Ctrl+Shift+G)"
                  className="px-2"
                >
                  <Ungroup className="w-3.5 h-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          {/* Alignment & Distribution */}
          <section aria-label="Align and distribute" className="flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Align &amp; Distribute
            </h3>
            <div className="grid grid-cols-8 gap-1">
              <AlignButton label="Align left" disabled={!canAlign} onClick={() => onAlign('left')}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="2" y="2" width="1.5" height="12" />
                  <rect x="5" y="4" width="8" height="3" rx="0.5" />
                  <rect x="5" y="9" width="5" height="3" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Align horizontal centers"
                disabled={!canAlign}
                onClick={() => onAlign('center')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="7.25" y="2" width="1.5" height="12" />
                  <rect x="3" y="4" width="10" height="3" rx="0.5" />
                  <rect x="5" y="9" width="6" height="3" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Align right"
                disabled={!canAlign}
                onClick={() => onAlign('right')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="12.5" y="2" width="1.5" height="12" />
                  <rect x="3" y="4" width="8" height="3" rx="0.5" />
                  <rect x="6" y="9" width="5" height="3" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton label="Align top" disabled={!canAlign} onClick={() => onAlign('top')}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="2" y="2" width="12" height="1.5" />
                  <rect x="4" y="5" width="3" height="8" rx="0.5" />
                  <rect x="9" y="5" width="3" height="5" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Align vertical centers"
                disabled={!canAlign}
                onClick={() => onAlign('middle')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="2" y="7.25" width="12" height="1.5" />
                  <rect x="4" y="3" width="3" height="10" rx="0.5" />
                  <rect x="9" y="5" width="3" height="6" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Align bottom"
                disabled={!canAlign}
                onClick={() => onAlign('bottom')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="2" y="12.5" width="12" height="1.5" />
                  <rect x="4" y="3" width="3" height="8" rx="0.5" />
                  <rect x="9" y="6" width="3" height="5" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Distribute horizontally"
                disabled={!canDistribute}
                onClick={() => onDistribute('horizontal')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="2" y="3" width="2.5" height="10" rx="0.5" />
                  <rect x="6.75" y="4" width="2.5" height="8" rx="0.5" />
                  <rect x="11.5" y="3" width="2.5" height="10" rx="0.5" />
                </svg>
              </AlignButton>
              <AlignButton
                label="Distribute vertically"
                disabled={!canDistribute}
                onClick={() => onDistribute('vertical')}
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                  <rect x="3" y="2" width="10" height="2.5" rx="0.5" />
                  <rect x="4" y="6.75" width="8" height="2.5" rx="0.5" />
                  <rect x="3" y="11.5" width="10" height="2.5" rx="0.5" />
                </svg>
              </AlignButton>
            </div>
          </section>

          {/* Layout & Transform */}
          <section aria-label="Transform" className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Layout
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <NumericField
                label="X"
                value={primary.x}
                disabled={readOnly}
                onCommit={(x) => patchSelection({ x })}
              />
              <NumericField
                label="Y"
                value={primary.y}
                disabled={readOnly}
                onCommit={(y) => patchSelection({ y })}
              />
              <NumericField
                label="W"
                value={primary.width}
                min={1}
                disabled={readOnly}
                onCommit={(width) => patchSelection({ width })}
              />
              <NumericField
                label="H"
                value={primary.height}
                min={1}
                disabled={readOnly}
                onCommit={(height) => patchSelection({ height })}
              />
              <NumericField
                label="Rotation"
                value={primary.rotation}
                suffix="°"
                disabled={readOnly}
                onCommit={(rotation) => patchSelection({ rotation })}
              />
              <NumericField
                label="Opacity"
                value={Math.round(primary.opacity * 100)}
                min={0}
                max={100}
                suffix="%"
                disabled={readOnly}
                onCommit={(pct) => patchSelection({ opacity: Math.max(0, Math.min(1, pct / 100)) })}
              />
            </div>

            {primary.type === 'rect' || primary.type === 'frame' || primary.type === 'image' ? (
              <NumericField
                label="Corner radius"
                value={primary.cornerRadius ?? 0}
                min={0}
                disabled={readOnly}
                onCommit={(cornerRadius) => patchSelection({ cornerRadius })}
              />
            ) : null}
          </section>

          {/* Appearance */}
          <section aria-label="Appearance" className="flex flex-col gap-3 border-t border-[var(--border)] pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Appearance
            </h3>

            {/* Fill */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={fillHexId}
                  className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Fill
                </label>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      patchSelection({
                        fill: primary.fill ? null : normalizeHexColor(null, '--accent'),
                      })
                    }
                    className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {primary.fill ? 'Clear' : 'Add fill'}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={fillInputId}
                  aria-label="Fill color picker"
                  type="color"
                  disabled={readOnly}
                  value={toColorInputValue(primary.fill)}
                  onChange={(e) => {
                    setFillText(e.target.value);
                    patchSelection({ fill: e.target.value });
                  }}
                  className="w-8 h-8 rounded border border-[var(--border)] bg-transparent cursor-pointer shrink-0 disabled:opacity-50"
                />
                <input
                  id={fillHexId}
                  aria-label="Fill hex"
                  type="text"
                  disabled={readOnly}
                  placeholder="none"
                  value={fillText}
                  onChange={(e) => setFillText(e.target.value)}
                  onBlur={() => {
                    const trimmed = fillText.trim();
                    if (!trimmed) {
                      patchSelection({ fill: null });
                    } else if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) {
                      patchSelection({ fill: trimmed });
                    } else {
                      setFillText(primary.fill ?? '');
                    }
                  }}
                  className="flex-1 min-w-0 h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[12px] font-mono text-[var(--text-primary)] disabled:opacity-50"
                />
              </div>
            </div>

            {/* Stroke */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={strokeHexId}
                  className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Stroke
                </label>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      patchSelection({
                        stroke: primary.stroke ? null : normalizeHexColor(null, '--text-primary'),
                        strokeWidth: primary.stroke ? 0 : Math.max(1, primary.strokeWidth || 2),
                      })
                    }
                    className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {primary.stroke ? 'Clear' : 'Add stroke'}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={strokeInputId}
                  aria-label="Stroke color picker"
                  type="color"
                  disabled={readOnly}
                  value={toColorInputValue(primary.stroke)}
                  onChange={(e) => {
                    setStrokeText(e.target.value);
                    patchSelection({
                      stroke: e.target.value,
                      strokeWidth: Math.max(1, primary.strokeWidth || 2),
                    });
                  }}
                  className="w-8 h-8 rounded border border-[var(--border)] bg-transparent cursor-pointer shrink-0 disabled:opacity-50"
                />
                <input
                  id={strokeHexId}
                  aria-label="Stroke hex"
                  type="text"
                  disabled={readOnly}
                  placeholder="none"
                  value={strokeText}
                  onChange={(e) => setStrokeText(e.target.value)}
                  onBlur={() => {
                    const trimmed = strokeText.trim();
                    if (!trimmed) {
                      patchSelection({ stroke: null, strokeWidth: 0 });
                    } else if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) {
                      patchSelection({
                        stroke: trimmed,
                        strokeWidth: Math.max(1, primary.strokeWidth || 2),
                      });
                    } else {
                      setStrokeText(primary.stroke ?? '');
                    }
                  }}
                  className="flex-1 min-w-0 h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[12px] font-mono text-[var(--text-primary)] disabled:opacity-50"
                />
              </div>

              <NumericField
                label="Stroke width"
                value={primary.strokeWidth}
                min={0}
                disabled={readOnly}
                onCommit={(strokeWidth) => patchSelection({ strokeWidth })}
              />
            </div>
          </section>

          {/* Typography (only single text selection) */}
          {selectedNodes.length === 1 && primary.type === 'text' ? (
            <section
              aria-label="Typography"
              className="flex flex-col gap-2 border-t border-[var(--border)] pt-3"
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Typography
              </h3>
              <label
                htmlFor={textAreaId}
                className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
              >
                Content
              </label>
              <textarea
                id={textAreaId}
                rows={3}
                disabled={readOnly}
                value={primary.text ?? ''}
                onChange={(e) => onSetText(primary.id, e.target.value)}
                className="w-full p-2 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] resize-y disabled:opacity-50"
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="font-family-select"
                    className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                  >
                    Font
                  </label>
                  <select
                    id="font-family-select"
                    disabled={readOnly}
                    value={primary.fontFamily ?? 'Inter'}
                    onChange={(e) => patchSelection({ fontFamily: e.target.value })}
                    className="h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <option value="Inter">Inter</option>
                    <option value="Space Grotesk">Space Grotesk</option>
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Georgia">Georgia</option>
                    <option value="system-ui">System UI</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="font-weight-select"
                    className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                  >
                    Weight
                  </label>
                  <select
                    id="font-weight-select"
                    disabled={readOnly}
                    value={String(primary.fontWeight ?? 400)}
                    onChange={(e) => patchSelection({ fontWeight: Number(e.target.value) })}
                    className="h-8 px-2 rounded-[var(--radius-control)] bg-[var(--bg-app)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <option value="400">Regular (400)</option>
                    <option value="600">SemiBold (600)</option>
                    <option value="700">Bold (700)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumericField
                  label="Font size"
                  value={primary.fontSize ?? 24}
                  min={8}
                  max={256}
                  disabled={readOnly}
                  onCommit={(fontSize) => patchSelection({ fontSize })}
                />
                <NumericField
                  label="Line height"
                  value={primary.lineHeight ?? 1.3}
                  min={0.8}
                  max={3}
                  step={0.1}
                  disabled={readOnly}
                  onCommit={(lineHeight) => patchSelection({ lineHeight })}
                />
              </div>
              <div className="flex items-center gap-1 pt-1" role="group" aria-label="Text alignment">
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={(primary.align ?? 'left') === align}
                    onClick={() => patchSelection({ align })}
                    className={`flex-1 h-7 rounded-[var(--radius-control)] border text-[11px] capitalize cursor-pointer disabled:opacity-50 ${
                      (primary.align ?? 'left') === align
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text-primary)]'
                        : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {align}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
