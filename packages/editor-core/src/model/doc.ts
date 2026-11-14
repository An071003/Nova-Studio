import {
  CanvasNodeSchema,
  DEFAULT_PAGE_ID,
  DOC_SCHEMA_VERSION,
  type CanvasNode,
  type NodeType,
} from '@nova/shared';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

/** Yjs transaction origin used for all local user-initiated mutations tracked by UndoManager. */
export const LOCAL_ORIGIN = 'nova:local';

/** Yjs transaction origin used when restoring a document snapshot from history/server. */
export const RESTORE_ORIGIN = 'restore';

export interface PageModel {
  id: string;
  name: string;
  index: string;
  background: string;
}

export interface DocRoots {
  meta: Y.Map<unknown>;
  pages: Y.Map<Y.Map<unknown>>;
  nodes: Y.Map<Y.Map<unknown>>;
}

export type CreateNodeInput = {
  id?: string;
  type: NodeType;
  pageId?: string;
  parentId?: string | null;
  index?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
  cornerRadius?: number;
  points?: number[];
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  assetId?: string;
  createdBy: string;
  updatedAt?: number;
};

export interface DocSnapshot {
  meta: Record<string, unknown>;
  pages: Record<string, PageModel>;
  nodes: CanvasNode[];
}

/** Returns the top-level Y.Map handles of a project Y.Doc without mutating it. */
export function getDocRoots(doc: Y.Doc): DocRoots {
  return {
    meta: doc.getMap<unknown>('meta'),
    pages: doc.getMap<Y.Map<unknown>>('pages'),
    nodes: doc.getMap<Y.Map<unknown>>('nodes'),
  };
}

/** Initializes `meta` and default `page:main` if absent on a newly created Y.Doc. */
export function initializeDocIfEmpty(doc: Y.Doc, opts?: { title?: string }): void {
  const { meta, pages } = getDocRoots(doc);
  if (
    meta.has('schemaVersion') &&
    meta.has('createdAt') &&
    (opts?.title === undefined || meta.has('title')) &&
    pages.has(DEFAULT_PAGE_ID)
  ) {
    return;
  }

  doc.transact(() => {
    if (!meta.has('schemaVersion')) {
      meta.set('schemaVersion', DOC_SCHEMA_VERSION);
    }
    if (!meta.has('createdAt')) {
      meta.set('createdAt', Date.now());
    }
    if (opts?.title !== undefined && !meta.has('title')) {
      meta.set('title', opts.title);
    }
    if (!pages.has(DEFAULT_PAGE_ID)) {
      const page = new Y.Map<unknown>();
      page.set('id', DEFAULT_PAGE_ID);
      page.set('name', 'Page 1');
      page.set('index', 'a0');
      page.set('background', '#1A1A1E');
      pages.set(DEFAULT_PAGE_ID, page);
    }
  }, LOCAL_ORIGIN);
}

/** Creates an initialized Y.Doc ready for collaborative canvas editing. */
export function createInitialDoc(opts?: { title?: string; clientId?: number }): Y.Doc {
  const doc = new Y.Doc();
  if (opts?.clientId !== undefined) {
    doc.clientID = opts.clientId;
  }
  initializeDocIfEmpty(doc, opts);
  return doc;
}

const DEFAULT_NAMES: Record<NodeType, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  text: 'Text',
  image: 'Image',
  group: 'Group',
  frame: 'Frame',
};

/** Produces a complete, Zod-valid CanvasNode with type-appropriate defaults. */
export function createDefaultNode(input: CreateNodeInput & { index: string }): CanvasNode {
  const now = input.updatedAt ?? Date.now();
  const id = input.id ?? nanoid(12);
  const type = input.type;

  const base: CanvasNode = {
    id,
    type,
    pageId: input.pageId ?? DEFAULT_PAGE_ID,
    parentId: input.parentId ?? null,
    index: input.index,
    name: input.name ?? DEFAULT_NAMES[type],
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? (type === 'ellipse' ? 120 : type === 'text' ? 200 : type === 'frame' ? 400 : 160),
    height: input.height ?? (type === 'line' ? 0 : type === 'ellipse' ? 120 : type === 'text' ? 40 : type === 'frame' ? 300 : 100),
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    fill:
      input.fill !== undefined
        ? input.fill
        : type === 'line' || type === 'group' || type === 'image'
          ? null
          : type === 'frame'
            ? '#24252B'
            : type === 'text'
              ? '#F4F4F5'
              : type === 'ellipse'
                ? '#38BDF8'
                : '#7C5CFF',
    stroke:
      input.stroke !== undefined
        ? input.stroke
        : type === 'line'
          ? '#E4E4E7'
          : type === 'frame'
            ? '#3F414D'
            : null,
    strokeWidth:
      input.strokeWidth !== undefined
        ? input.strokeWidth
        : type === 'line'
          ? 2
          : type === 'frame'
            ? 1
            : 0,
    createdBy: input.createdBy,
    updatedAt: now,
  };

  if (type === 'rect' || type === 'frame') {
    base.cornerRadius = input.cornerRadius ?? (type === 'rect' ? 8 : 0);
  } else if (input.cornerRadius !== undefined) {
    base.cornerRadius = input.cornerRadius;
  }

  if (type === 'line') {
    base.points = input.points ?? [0, 0, base.width, 0];
  } else if (input.points !== undefined) {
    base.points = input.points;
  }

  if (type === 'text') {
    base.text = input.text ?? 'Double-click to edit';
    base.fontFamily = input.fontFamily ?? 'Inter';
    base.fontSize = input.fontSize ?? 24;
    base.fontWeight = input.fontWeight ?? 600;
    base.align = input.align ?? 'left';
    base.lineHeight = input.lineHeight ?? 1.3;
  } else {
    if (input.text !== undefined) base.text = input.text;
    if (input.fontFamily !== undefined) base.fontFamily = input.fontFamily;
    if (input.fontSize !== undefined) base.fontSize = input.fontSize;
    if (input.fontWeight !== undefined) base.fontWeight = input.fontWeight;
    if (input.align !== undefined) base.align = input.align;
    if (input.lineHeight !== undefined) base.lineHeight = input.lineHeight;
  }

  if (input.assetId !== undefined) {
    base.assetId = input.assetId;
  }

  return CanvasNodeSchema.parse(base);
}

/**
 * Writes every defined field on `node` as an individual key in `nodeMap` for
 * per-field LWW convergence. Attaches `Y.Text` to `nodeMap` before inserting content.
 */
export function writeNodeToMap(nodeMap: Y.Map<unknown>, node: CanvasNode): void {
  nodeMap.set('id', node.id);
  nodeMap.set('type', node.type);
  nodeMap.set('pageId', node.pageId);
  nodeMap.set('parentId', node.parentId);
  nodeMap.set('index', node.index);
  nodeMap.set('name', node.name);
  nodeMap.set('x', node.x);
  nodeMap.set('y', node.y);
  nodeMap.set('width', node.width);
  nodeMap.set('height', node.height);
  nodeMap.set('rotation', node.rotation);
  nodeMap.set('opacity', node.opacity);
  nodeMap.set('visible', node.visible);
  nodeMap.set('locked', node.locked);
  nodeMap.set('fill', node.fill);
  nodeMap.set('stroke', node.stroke);
  nodeMap.set('strokeWidth', node.strokeWidth);
  nodeMap.set('createdBy', node.createdBy);
  nodeMap.set('updatedAt', node.updatedAt);

  if (node.cornerRadius !== undefined) nodeMap.set('cornerRadius', node.cornerRadius);
  if (node.points !== undefined) nodeMap.set('points', [...node.points]);
  if (node.fontFamily !== undefined) nodeMap.set('fontFamily', node.fontFamily);
  if (node.fontSize !== undefined) nodeMap.set('fontSize', node.fontSize);
  if (node.fontWeight !== undefined) nodeMap.set('fontWeight', node.fontWeight);
  if (node.align !== undefined) nodeMap.set('align', node.align);
  if (node.lineHeight !== undefined) nodeMap.set('lineHeight', node.lineHeight);
  if (node.assetId !== undefined) nodeMap.set('assetId', node.assetId);

  if (node.type === 'text' || node.text !== undefined) {
    const content = node.text ?? '';
    const existing = nodeMap.get('text');
    if (existing instanceof Y.Text) {
      if (existing.toString() !== content) {
        existing.delete(0, existing.length);
        if (content.length > 0) {
          existing.insert(0, content);
        }
      }
    } else {
      // L-001: attach Y.Text to its parent Y.Map inside transact before calling insert
      const ytext = new Y.Text();
      nodeMap.set('text', ytext);
      if (content.length > 0) {
        ytext.insert(0, content);
      }
    }
  }
}

/** Reads and Zod-validates a node from a `Y.Map`, returning null if invalid/incomplete. */
export function readNodeFromMap(nodeMap: Y.Map<unknown>): CanvasNode | null {
  const raw: Record<string, unknown> = {};
  nodeMap.forEach((value, key) => {
    if (key === 'text' && value instanceof Y.Text) {
      raw[key] = value.doc !== null ? value.toString() : '';
    } else {
      raw[key] = value;
    }
  });
  if (raw.id !== undefined && raw.updatedAt === undefined) {
    raw.updatedAt = 0;
  }

  const parsed = CanvasNodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Lexicographic ASCII comparison required for fractional-indexing z-order keys. */
export function compareNodesByIndex(a: CanvasNode, b: CanvasNode): number {
  if (a.index < b.index) return -1;
  if (a.index > b.index) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reads all valid nodes from the Y.Doc sorted in deterministic paint/z-order. */
export function readAllNodesSorted(doc: Y.Doc): CanvasNode[] {
  const { nodes } = getDocRoots(doc);
  const result: CanvasNode[] = [];
  nodes.forEach((nodeMap) => {
    const parsed = readNodeFromMap(nodeMap);
    if (parsed) {
      result.push(parsed);
    }
  });
  result.sort(compareNodesByIndex);
  return result;
}

/** Returns siblings sharing `(pageId, parentId)` sorted by fractional index. */
export function getSiblingsSorted(
  doc: Y.Doc,
  pageId: string,
  parentId: string | null,
): CanvasNode[] {
  return readAllNodesSorted(doc).filter(
    (node) => node.pageId === pageId && node.parentId === parentId,
  );
}

/** Serializes the full Y.Doc into a deterministic plain-JSON snapshot for assertions. */
export function serializeDocSnapshot(doc: Y.Doc): DocSnapshot {
  const { meta, pages } = getDocRoots(doc);
  const metaObj: Record<string, unknown> = {};
  Array.from(meta.keys())
    .sort()
    .forEach((key) => {
      metaObj[key] = meta.get(key);
    });

  const pagesObj: Record<string, PageModel> = {};
  Array.from(pages.keys())
    .sort()
    .forEach((pageId) => {
      const pageMap = pages.get(pageId);
      if (pageMap) {
        pagesObj[pageId] = {
          id: String(pageMap.get('id') ?? pageId),
          name: String(pageMap.get('name') ?? 'Page'),
          index: String(pageMap.get('index') ?? 'a0'),
          background: String(pageMap.get('background') ?? '#1A1A1E'),
        };
      }
    });

  return {
    meta: metaObj,
    pages: pagesObj,
    nodes: readAllNodesSorted(doc),
  };
}
