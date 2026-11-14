import { CanvasNodeSchema, DEFAULT_PAGE_ID, type CanvasNode } from '@nova/shared';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';
import {
  compareNodesByIndex,
  createDefaultNode,
  getDocRoots,
  getSiblingsSorted,
  initializeDocIfEmpty,
  LOCAL_ORIGIN,
  readAllNodesSorted,
  readNodeFromMap,
  writeNodeToMap,
  type CreateNodeInput,
} from '../model/doc.js';
import { generateJitteredKeyBetween, generateSequentialKeys } from '../model/indexing.js';

export type NodePatch = Partial<
  Omit<CanvasNode, 'id' | 'type' | 'createdBy'>
>;

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

export type EditorCommand =
  | { type: 'createNode'; input: Omit<CreateNodeInput, 'createdBy'> }
  | { type: 'updateNodes'; patches: Array<{ id: string; patch: NodePatch }> }
  | { type: 'deleteNodes'; ids: string[] }
  | { type: 'moveNodes'; ids: string[]; dx: number; dy: number }
  | {
      type: 'reorder';
      nodeId: string;
      /** Key strictly before the target slot (lower bound). */
      afterIndex?: string | null;
      /** Key strictly after the target slot (upper bound). */
      beforeIndex?: string | null;
      /** Sibling ID immediately before the target slot. */
      afterId?: string | null;
      /** Sibling ID immediately after the target slot. */
      beforeId?: string | null;
      parentId?: string | null;
    }
  | { type: 'group'; ids: string[]; groupId?: string; name?: string }
  | { type: 'ungroup'; id: string }
  | { type: 'setText'; nodeId: string; text: string }
  | {
      type: 'editText';
      nodeId: string;
      index: number;
      deleteCount: number;
      insertText: string;
    }
  | { type: 'alignNodes'; ids: string[]; mode: AlignMode }
  | { type: 'distributeNodes'; ids: string[]; axis: DistributeAxis }
  | { type: 'duplicate'; ids: string[]; offset?: { x: number; y: number } }
  | {
      type: 'pasteNodes';
      nodes: CanvasNode[];
      offset?: { x: number; y: number };
      targetPageId?: string;
      targetParentId?: string | null;
    };

export interface CommandResult {
  createdIds: string[];
  deletedIds: string[];
  updatedIds: string[];
}

function collectSubtreeIds(rootIds: string[], allNodes: CanvasNode[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  const existingIds = new Set<string>();
  for (const n of allNodes) {
    existingIds.add(n.id);
    if (n.parentId !== null) {
      const list = childrenByParent.get(n.parentId);
      if (list) {
        list.push(n.id);
      } else {
        childrenByParent.set(n.parentId, [n.id]);
      }
    }
  }

  const collected = new Set<string>();
  const stack: string[] = [];
  for (const id of rootIds) {
    if (existingIds.has(id) && !collected.has(id)) {
      collected.add(id);
      stack.push(id);
    }
  }
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = childrenByParent.get(current);
    if (children) {
      for (const childId of children) {
        if (!collected.has(childId)) {
          collected.add(childId);
          stack.push(childId);
        }
      }
    }
  }
  return collected;
}

/** Computes minimal splice diff and updates `Y.Text` in place without clobbering unrelated CRDT ops. */
function applyTextReplace(ytext: Y.Text, nextText: string): void {
  const prev = ytext.toString();
  if (prev === nextText) {
    return;
  }
  let start = 0;
  const minLen = Math.min(prev.length, nextText.length);
  while (start < minLen && prev.charCodeAt(start) === nextText.charCodeAt(start)) {
    start += 1;
  }
  let prevEnd = prev.length;
  let nextEnd = nextText.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    prev.charCodeAt(prevEnd - 1) === nextText.charCodeAt(nextEnd - 1)
  ) {
    prevEnd -= 1;
    nextEnd -= 1;
  }
  const delCount = prevEnd - start;
  const insertStr = nextText.slice(start, nextEnd);
  if (delCount > 0) {
    ytext.delete(start, delCount);
  }
  if (insertStr.length > 0) {
    ytext.insert(start, insertStr);
  }
}

function getBounds(nodes: CanvasNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Pure Yjs command executor. Every document mutation runs inside `doc.transact(..., LOCAL_ORIGIN)`
 * so Yjs UndoManager and multiplayer replication remain consistent and renderer-agnostic.
 */
export class CommandBus {
  private readOnly: boolean;

  constructor(
    private readonly doc: Y.Doc,
    private readonly userId: string,
    opts?: { readOnly?: boolean },
  ) {
    this.readOnly = opts?.readOnly ?? false;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  execute(cmd: EditorCommand): CommandResult {
    const empty: CommandResult = { createdIds: [], deletedIds: [], updatedIds: [] };
    if (this.readOnly) {
      return empty;
    }

    const result: CommandResult = { createdIds: [], deletedIds: [], updatedIds: [] };
    initializeDocIfEmpty(this.doc);

    this.doc.transact(() => {
      switch (cmd.type) {
        case 'createNode': {
          const id = this.handleCreateNode(cmd.input);
          result.createdIds.push(id);
          break;
        }
        case 'updateNodes': {
          result.updatedIds.push(...this.handleUpdateNodes(cmd.patches));
          break;
        }
        case 'deleteNodes': {
          result.deletedIds.push(...this.handleDeleteNodes(cmd.ids));
          break;
        }
        case 'moveNodes': {
          result.updatedIds.push(...this.handleMoveNodes(cmd.ids, cmd.dx, cmd.dy));
          break;
        }
        case 'reorder': {
          const updated = this.handleReorder(cmd);
          if (updated) {
            result.updatedIds.push(updated);
          }
          break;
        }
        case 'group': {
          const groupId = this.handleGroup(cmd.ids, cmd.groupId, cmd.name);
          if (groupId) {
            result.createdIds.push(groupId);
          }
          break;
        }
        case 'ungroup': {
          const res = this.handleUngroup(cmd.id);
          result.deletedIds.push(...res.deletedIds);
          result.updatedIds.push(...res.updatedIds);
          break;
        }
        case 'setText': {
          if (this.handleSetText(cmd.nodeId, cmd.text)) {
            result.updatedIds.push(cmd.nodeId);
          }
          break;
        }
        case 'editText': {
          if (this.handleEditText(cmd.nodeId, cmd.index, cmd.deleteCount, cmd.insertText)) {
            result.updatedIds.push(cmd.nodeId);
          }
          break;
        }
        case 'alignNodes': {
          result.updatedIds.push(...this.handleAlignNodes(cmd.ids, cmd.mode));
          break;
        }
        case 'distributeNodes': {
          result.updatedIds.push(...this.handleDistributeNodes(cmd.ids, cmd.axis));
          break;
        }
        case 'duplicate': {
          result.createdIds.push(...this.handleDuplicate(cmd.ids, cmd.offset));
          break;
        }
        case 'pasteNodes': {
          result.createdIds.push(
            ...this.handlePasteNodes(
              cmd.nodes,
              cmd.offset,
              cmd.targetPageId,
              cmd.targetParentId,
            ),
          );
          break;
        }
      }
    }, LOCAL_ORIGIN);

    return result;
  }

  private handleCreateNode(input: Omit<CreateNodeInput, 'createdBy'>): string {
    const { nodes } = getDocRoots(this.doc);
    const pageId = input.pageId ?? DEFAULT_PAGE_ID;
    const parentId = input.parentId ?? null;

    let index = input.index;
    if (!index) {
      const siblings = getSiblingsSorted(this.doc, pageId, parentId);
      const last = siblings[siblings.length - 1];
      index = generateJitteredKeyBetween(last?.index ?? null, null, this.doc.clientID);
    }

    const node = createDefaultNode({
      ...input,
      createdBy: this.userId,
      index,
    });
    const nodeMap = new Y.Map<unknown>();
    // Attach nodeMap into doc before writeNodeToMap creates/inserts Y.Text (L-001)
    nodes.set(node.id, nodeMap);
    writeNodeToMap(nodeMap, node);
    return node.id;
  }

  private handleUpdateNodes(patches: Array<{ id: string; patch: NodePatch }>): string[] {
    const { nodes } = getDocRoots(this.doc);
    const now = Date.now();
    const updatedIds: string[] = [];

    for (const { id, patch } of patches) {
      const nodeMap = nodes.get(id);
      if (!nodeMap) {
        continue;
      }

      const keys = Object.keys(patch) as Array<keyof NodePatch>;
      for (const key of keys) {
        const value = patch[key];
        if (value === undefined) {
          continue;
        }
        if (key === 'text') {
          this.writeTextField(nodeMap, String(value));
        } else if (key === 'points' && Array.isArray(value)) {
          nodeMap.set(key, [...value]);
        } else {
          nodeMap.set(key, value);
        }
      }
      nodeMap.set('updatedAt', patch.updatedAt ?? now);
      updatedIds.push(id);
    }
    return updatedIds;
  }

  private handleDeleteNodes(ids: string[]): string[] {
    const { nodes } = getDocRoots(this.doc);
    const allNodes = readAllNodesSorted(this.doc);
    const toDelete = collectSubtreeIds(ids, allNodes);
    for (const id of toDelete) {
      nodes.delete(id);
    }
    return Array.from(toDelete);
  }

  private handleMoveNodes(ids: string[], dx: number, dy: number): string[] {
    if (dx === 0 && dy === 0) {
      return [];
    }
    const { nodes } = getDocRoots(this.doc);
    const allNodes = readAllNodesSorted(this.doc);
    const targetIds = collectSubtreeIds(ids, allNodes);
    const now = Date.now();
    const updatedIds: string[] = [];

    for (const id of targetIds) {
      const nodeMap = nodes.get(id);
      if (!nodeMap) {
        continue;
      }
      const curX = nodeMap.get('x');
      const curY = nodeMap.get('y');
      if (typeof curX === 'number' && typeof curY === 'number') {
        nodeMap.set('x', curX + dx);
        nodeMap.set('y', curY + dy);
        nodeMap.set('updatedAt', now);
        updatedIds.push(id);
      }
    }
    return updatedIds;
  }

  private handleReorder(cmd: Extract<EditorCommand, { type: 'reorder' }>): string | null {
    const { nodes } = getDocRoots(this.doc);
    const nodeMap = nodes.get(cmd.nodeId);
    if (!nodeMap) {
      return null;
    }
    const existing = readNodeFromMap(nodeMap);
    if (!existing) {
      return null;
    }

    const nextParentId = cmd.parentId !== undefined ? cmd.parentId : existing.parentId;
    let lo = cmd.afterIndex ?? null;
    let hi = cmd.beforeIndex ?? null;

    if (cmd.afterId !== undefined) {
      const afterNode = cmd.afterId ? nodes.get(cmd.afterId) : undefined;
      lo = typeof afterNode?.get('index') === 'string' ? (afterNode.get('index') as string) : null;
    }
    if (cmd.beforeId !== undefined) {
      const beforeNode = cmd.beforeId ? nodes.get(cmd.beforeId) : undefined;
      hi =
        typeof beforeNode?.get('index') === 'string' ? (beforeNode.get('index') as string) : null;
    }

    const nextIndex = generateJitteredKeyBetween(lo, hi, this.doc.clientID);
    if (cmd.parentId !== undefined) {
      nodeMap.set('parentId', nextParentId);
    }
    nodeMap.set('index', nextIndex);
    nodeMap.set('updatedAt', Date.now());
    return cmd.nodeId;
  }

  private handleGroup(ids: string[], explicitGroupId?: string, name?: string): string | null {
    const { nodes } = getDocRoots(this.doc);
    const allNodes = readAllNodesSorted(this.doc);
    const idSet = new Set(ids);
    const targets = allNodes.filter((n) => idSet.has(n.id));
    if (targets.length === 0) {
      return null;
    }

    const primaryPageId = targets[0]!.pageId;
    const samePageTargets = targets.filter((n) => n.pageId === primaryPageId);
    const targetParentId = samePageTargets[0]!.parentId;
    const bounds = getBounds(samePageTargets);

    const siblings = getSiblingsSorted(this.doc, primaryPageId, targetParentId);
    const maxTargetIndex = samePageTargets[samePageTargets.length - 1]!.index;
    const afterTarget = siblings.find(
      (s) => s.index > maxTargetIndex && !idSet.has(s.id),
    );
    const groupIndex = generateJitteredKeyBetween(
      maxTargetIndex,
      afterTarget?.index ?? null,
      this.doc.clientID,
    );

    const groupId = explicitGroupId ?? nanoid(12);
    const groupNode = createDefaultNode({
      id: groupId,
      type: 'group',
      pageId: primaryPageId,
      parentId: targetParentId,
      index: groupIndex,
      name: name ?? 'Group',
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      createdBy: this.userId,
    });

    const groupMap = new Y.Map<unknown>();
    nodes.set(groupId, groupMap);
    writeNodeToMap(groupMap, groupNode);

    const now = Date.now();
    const childKeys = generateSequentialKeys(null, null, samePageTargets.length, this.doc.clientID);
    samePageTargets.forEach((child, i) => {
      const childMap = nodes.get(child.id);
      if (childMap) {
        childMap.set('parentId', groupId);
        childMap.set('index', childKeys[i]!);
        childMap.set('updatedAt', now);
      }
    });

    return groupId;
  }

  private handleUngroup(groupId: string): { deletedIds: string[]; updatedIds: string[] } {
    const { nodes } = getDocRoots(this.doc);
    const groupMap = nodes.get(groupId);
    if (!groupMap) {
      return { deletedIds: [], updatedIds: [] };
    }
    const groupNode = readNodeFromMap(groupMap);
    if (!groupNode || groupNode.type !== 'group') {
      return { deletedIds: [], updatedIds: [] };
    }

    const siblings = getSiblingsSorted(this.doc, groupNode.pageId, groupNode.parentId);
    const groupPos = siblings.findIndex((s) => s.id === groupId);
    const prevSibling = groupPos > 0 ? siblings[groupPos - 1] : undefined;
    const nextSibling = groupPos >= 0 && groupPos + 1 < siblings.length ? siblings[groupPos + 1] : undefined;

    const children = getSiblingsSorted(this.doc, groupNode.pageId, groupId);
    const newIndices = generateSequentialKeys(
      prevSibling?.index ?? null,
      nextSibling?.index ?? null,
      children.length,
      this.doc.clientID,
    );

    const now = Date.now();
    const updatedIds: string[] = [];
    children.forEach((child, i) => {
      const childMap = nodes.get(child.id);
      if (childMap) {
        childMap.set('parentId', groupNode.parentId);
        childMap.set('index', newIndices[i]!);
        childMap.set('updatedAt', now);
        updatedIds.push(child.id);
      }
    });

    nodes.delete(groupId);
    return { deletedIds: [groupId], updatedIds };
  }

  private writeTextField(nodeMap: Y.Map<unknown>, nextText: string): void {
    const existing = nodeMap.get('text');
    if (existing instanceof Y.Text) {
      applyTextReplace(existing, nextText);
    } else {
      // L-001: attach before insert
      const ytext = new Y.Text();
      nodeMap.set('text', ytext);
      if (nextText.length > 0) {
        ytext.insert(0, nextText);
      }
    }
  }

  private handleSetText(nodeId: string, text: string): boolean {
    const { nodes } = getDocRoots(this.doc);
    const nodeMap = nodes.get(nodeId);
    if (!nodeMap) {
      return false;
    }
    const hadTextType = nodeMap.get('text') instanceof Y.Text;
    this.writeTextField(nodeMap, text);
    // Avoid touching nodeMap keys on pure Y.Text edits so concurrent text typing never conflicts on LWW updatedAt
    if (!hadTextType) {
      nodeMap.set('updatedAt', Date.now());
    }
    return true;
  }

  private handleEditText(
    nodeId: string,
    index: number,
    deleteCount: number,
    insertText: string,
  ): boolean {
    const { nodes } = getDocRoots(this.doc);
    const nodeMap = nodes.get(nodeId);
    if (!nodeMap) {
      return false;
    }

    let ytext = nodeMap.get('text');
    const hadTextType = ytext instanceof Y.Text;
    if (!hadTextType) {
      const created = new Y.Text();
      nodeMap.set('text', created);
      ytext = created;
    }
    const textType = ytext as Y.Text;
    const clampedIndex = Math.max(0, Math.min(index, textType.length));
    const clampedDelete = Math.max(0, Math.min(deleteCount, textType.length - clampedIndex));

    if (clampedDelete > 0) {
      textType.delete(clampedIndex, clampedDelete);
    }
    if (insertText.length > 0) {
      textType.insert(clampedIndex, insertText);
    }
    if (!hadTextType) {
      nodeMap.set('updatedAt', Date.now());
    }
    return true;
  }

  private handleAlignNodes(ids: string[], mode: AlignMode): string[] {
    const { nodes } = getDocRoots(this.doc);
    const allNodes = readAllNodesSorted(this.doc);
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const targets = ids
      .map((id) => byId.get(id))
      .filter((n): n is CanvasNode => n !== undefined);
    if (targets.length < 2) {
      return [];
    }

    const bounds = getBounds(targets);
    const now = Date.now();
    const updatedSet = new Set<string>();

    for (const target of targets) {
      let dx = 0;
      let dy = 0;
      switch (mode) {
        case 'left':
          dx = bounds.minX - target.x;
          break;
        case 'center':
          dx = (bounds.minX + bounds.maxX) / 2 - (target.x + target.width / 2);
          break;
        case 'right':
          dx = bounds.maxX - (target.x + target.width);
          break;
        case 'top':
          dy = bounds.minY - target.y;
          break;
        case 'middle':
          dy = (bounds.minY + bounds.maxY) / 2 - (target.y + target.height / 2);
          break;
        case 'bottom':
          dy = bounds.maxY - (target.y + target.height);
          break;
      }
      if (dx === 0 && dy === 0) {
        continue;
      }

      const subtree = collectSubtreeIds([target.id], allNodes);
      for (const subId of subtree) {
        const subMap = nodes.get(subId);
        if (!subMap) {
          continue;
        }
        const cx = subMap.get('x');
        const cy = subMap.get('y');
        if (typeof cx === 'number' && typeof cy === 'number') {
          subMap.set('x', cx + dx);
          subMap.set('y', cy + dy);
          subMap.set('updatedAt', now);
          updatedSet.add(subId);
        }
      }
    }
    return Array.from(updatedSet);
  }

  private handleDistributeNodes(ids: string[], axis: DistributeAxis): string[] {
    const { nodes } = getDocRoots(this.doc);
    const allNodes = readAllNodesSorted(this.doc);
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const targets = ids
      .map((id) => byId.get(id))
      .filter((n): n is CanvasNode => n !== undefined);
    if (targets.length < 3) {
      return [];
    }

    const sorted = [...targets].sort((a, b) =>
      axis === 'horizontal' ? a.x - b.x : a.y - b.y,
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const totalSize = sorted.reduce(
      (sum, n) => sum + (axis === 'horizontal' ? n.width : n.height),
      0,
    );
    const startPos = axis === 'horizontal' ? first.x : first.y;
    const endEdge =
      axis === 'horizontal' ? last.x + last.width : last.y + last.height;
    const gap = (endEdge - startPos - totalSize) / (sorted.length - 1);

    let cursor = startPos + (axis === 'horizontal' ? first.width : first.height) + gap;
    const now = Date.now();
    const updatedSet = new Set<string>();

    for (let i = 1; i < sorted.length - 1; i += 1) {
      const target = sorted[i]!;
      const curPos = axis === 'horizontal' ? target.x : target.y;
      const delta = cursor - curPos;
      cursor += (axis === 'horizontal' ? target.width : target.height) + gap;
      if (Math.abs(delta) < 1e-6) {
        continue;
      }

      const subtree = collectSubtreeIds([target.id], allNodes);
      for (const subId of subtree) {
        const subMap = nodes.get(subId);
        if (!subMap) {
          continue;
        }
        if (axis === 'horizontal') {
          const cx = subMap.get('x');
          if (typeof cx === 'number') {
            subMap.set('x', cx + delta);
          }
        } else {
          const cy = subMap.get('y');
          if (typeof cy === 'number') {
            subMap.set('y', cy + delta);
          }
        }
        subMap.set('updatedAt', now);
        updatedSet.add(subId);
      }
    }
    return Array.from(updatedSet);
  }

  private handleDuplicate(
    ids: string[],
    offset: { x: number; y: number } = { x: 20, y: 20 },
  ): string[] {
    const allNodes = readAllNodesSorted(this.doc);
    const subtreeIds = collectSubtreeIds(ids, allNodes);
    const sourceNodes = allNodes.filter((n) => subtreeIds.has(n.id));
    if (sourceNodes.length === 0) {
      return [];
    }
    return this.cloneNodeList(sourceNodes, offset, undefined, undefined, ids);
  }

  private handlePasteNodes(
    rawNodes: CanvasNode[],
    offset: { x: number; y: number } = { x: 20, y: 20 },
    targetPageId?: string,
    targetParentId?: string | null,
  ): string[] {
    const validNodes = rawNodes
      .map((n) => CanvasNodeSchema.safeParse(n))
      .filter((r) => r.success)
      .map((r) => r.data);
    if (validNodes.length === 0) {
      return [];
    }
    return this.cloneNodeList(validNodes, offset, targetPageId, targetParentId);
  }

  private cloneNodeList(
    sourceNodes: CanvasNode[],
    offset: { x: number; y: number },
    targetPageId?: string,
    targetParentId?: string | null,
    explicitRootIds?: string[],
  ): string[] {
    const { nodes } = getDocRoots(this.doc);
    const sorted = [...sourceNodes].sort(compareNodesByIndex);
    const idMap = new Map<string, string>();
    for (const s of sorted) {
      idMap.set(s.id, nanoid(12));
    }

    const now = Date.now();
    const topIds: string[] = [];
    const rootCandidateSet = explicitRootIds ? new Set(explicitRootIds) : null;

    // Cache tail index per (pageId, parentId) so siblings get clean ascending keys
    const tailIndexCache = new Map<string, string | null>();
    const nextIndexFor = (pageId: string, parentId: string | null): string => {
      const key = `${pageId}::${parentId ?? ''}`;
      if (!tailIndexCache.has(key)) {
        const siblings = getSiblingsSorted(this.doc, pageId, parentId);
        tailIndexCache.set(key, siblings[siblings.length - 1]?.index ?? null);
      }
      const prev = tailIndexCache.get(key) ?? null;
      const next = generateJitteredKeyBetween(prev, null, this.doc.clientID, tailIndexCache.size);
      tailIndexCache.set(key, next);
      return next;
    };

    for (const src of sorted) {
      const newId = idMap.get(src.id)!;
      const remappedParent = src.parentId !== null ? idMap.get(src.parentId) ?? null : null;
      const isSubtreeRoot = remappedParent === null;

      const resolvedPageId = targetPageId ?? src.pageId;
      const resolvedParentId =
        remappedParent !== null
          ? remappedParent
          : targetParentId !== undefined
            ? targetParentId
            : src.parentId;

      if (isSubtreeRoot || rootCandidateSet?.has(src.id)) {
        topIds.push(newId);
      }

      const cloned: CanvasNode = {
        ...src,
        id: newId,
        pageId: resolvedPageId,
        parentId: resolvedParentId,
        index: nextIndexFor(resolvedPageId, resolvedParentId),
        x: src.x + offset.x,
        y: src.y + offset.y,
        createdBy: this.userId,
        updatedAt: now,
      };
      if (src.points) {
        cloned.points = [...src.points];
      }

      const nodeMap = new Y.Map<unknown>();
      nodes.set(cloned.id, nodeMap);
      writeNodeToMap(nodeMap, cloned);
    }

    return topIds;
  }
}
